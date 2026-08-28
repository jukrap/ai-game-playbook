using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AiGamePlaybook.WindowsContainment;

internal static partial class Protocol
{
    internal const int MaximumInputBytes = 16 * 1024;
    internal const int MaximumDurationMs = 30_000;
    private const int MinimumValidityMs = 30_000;
    private const int MaximumValidityMs = 60_000;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    [GeneratedRegex("^sha256:[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex DigestPattern();

    internal static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
    };

    internal static async Task<NativeSelfTestRequest> ReadRequestAsync()
    {
        Stream input = Console.OpenStandardInput();
        byte[] buffer = new byte[MaximumInputBytes + 1];
        int total = 0;
        while (total < buffer.Length)
        {
            int read = await input.ReadAsync(buffer.AsMemory(total, buffer.Length - total));
            if (read == 0)
            {
                break;
            }
            total += read;
        }
        if (total == 0 || total > MaximumInputBytes)
        {
            throw new ProtocolException("request-size-invalid");
        }

        string text;
        try
        {
            text = StrictUtf8.GetString(buffer, 0, total).TrimEnd('\r', '\n');
        }
        catch (DecoderFallbackException)
        {
            throw new ProtocolException("request-encoding-invalid");
        }
        if (text.Length == 0 || text.Contains('\0'))
        {
            throw new ProtocolException("request-encoding-invalid");
        }

        using JsonDocument document = JsonDocument.Parse(
            text,
            new JsonDocumentOptions
            {
                AllowTrailingCommas = false,
                CommentHandling = JsonCommentHandling.Disallow,
                MaxDepth = 8,
            });
        JsonElement root = document.RootElement;
        if (root.ValueKind != JsonValueKind.Object)
        {
            throw new ProtocolException("request-shape-invalid");
        }

        string[] expected =
        {
            "schemaVersion",
            "operation",
            "selfTestId",
            "requestDigest",
            "entryArtifactDigest",
            "challengeDigest",
            "fixtureIdentityDigest",
            "issuedAt",
            "expiresAt",
            "maxDurationMs",
        };
        var properties = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (JsonProperty property in root.EnumerateObject())
        {
            if (!properties.TryAdd(property.Name, property.Value))
            {
                throw new ProtocolException("request-duplicate-field");
            }
        }
        if (properties.Count != expected.Length || expected.Any(name => !properties.ContainsKey(name)))
        {
            throw new ProtocolException("request-shape-invalid");
        }

        string schemaVersion = RequiredString(properties, "schemaVersion");
        string operation = RequiredString(properties, "operation");
        string selfTestId = RequiredString(properties, "selfTestId");
        string requestDigest = RequiredDigest(properties, "requestDigest");
        string entryArtifactDigest = RequiredDigest(properties, "entryArtifactDigest");
        string challengeDigest = RequiredDigest(properties, "challengeDigest");
        string fixtureIdentityDigest = RequiredDigest(properties, "fixtureIdentityDigest");
        DateTimeOffset issuedAt = RequiredTimestamp(properties, "issuedAt");
        DateTimeOffset expiresAt = RequiredTimestamp(properties, "expiresAt");
        JsonElement duration = properties["maxDurationMs"];

        if (
            schemaVersion != "1.0.0"
            || operation != "self-test"
            || !Guid.TryParseExact(selfTestId, "D", out Guid parsedId)
            || !string.Equals(parsedId.ToString("D"), selfTestId, StringComparison.Ordinal)
            || duration.ValueKind != JsonValueKind.Number
            || !duration.TryGetInt32(out int maxDurationMs)
            || maxDurationMs != MaximumDurationMs)
        {
            throw new ProtocolException("request-value-invalid");
        }
        long validityMs = (long)(expiresAt - issuedAt).TotalMilliseconds;
        DateTimeOffset now = DateTimeOffset.UtcNow;
        if (
            validityMs < MinimumValidityMs
            || validityMs > MaximumValidityMs
            || now < issuedAt
            || now >= expiresAt)
        {
            throw new ProtocolException("request-window-invalid");
        }

        return new NativeSelfTestRequest(
            schemaVersion,
            operation,
            selfTestId,
            requestDigest,
            entryArtifactDigest,
            challengeDigest,
            fixtureIdentityDigest,
            issuedAt,
            expiresAt,
            maxDurationMs);
    }

    internal static string ComputeFileDigest(string path)
    {
        using FileStream stream = new(
            path,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read | FileShare.Delete,
            128 * 1024,
            FileOptions.SequentialScan);
        return $"sha256:{Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant()}";
    }

    internal static string ComputeStreamDigest(Stream stream)
    {
        if (!stream.CanSeek || !stream.CanRead)
        {
            throw new ArgumentException("digest-stream-invalid", nameof(stream));
        }
        stream.Position = 0;
        string digest = $"sha256:{Convert.ToHexString(SHA256.HashData(stream)).ToLowerInvariant()}";
        stream.Position = 0;
        return digest;
    }

    internal static string FormatTimestamp(DateTimeOffset value) =>
        value.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'", System.Globalization.CultureInfo.InvariantCulture);

    internal static DateTimeOffset TruncateToMilliseconds(DateTimeOffset value) =>
        new(value.Ticks - (value.Ticks % TimeSpan.TicksPerMillisecond), TimeSpan.Zero);

    internal static void WriteJson<T>(T value) =>
        Console.Out.WriteLine(JsonSerializer.Serialize(value, JsonOptions));

    private static string RequiredString(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        JsonElement value = properties[name];
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new ProtocolException("request-value-invalid");
        }
        string? result = value.GetString();
        if (string.IsNullOrEmpty(result) || result.Length > 256 || result.Contains('\0'))
        {
            throw new ProtocolException("request-value-invalid");
        }
        return result;
    }

    private static string RequiredDigest(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        string value = RequiredString(properties, name);
        if (!DigestPattern().IsMatch(value))
        {
            throw new ProtocolException("request-digest-invalid");
        }
        return value;
    }

    private static DateTimeOffset RequiredTimestamp(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        string value = RequiredString(properties, name);
        if (
            !DateTimeOffset.TryParseExact(
                value,
                "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out DateTimeOffset parsed)
            || Protocol.FormatTimestamp(parsed) != value)
        {
            throw new ProtocolException("request-timestamp-invalid");
        }
        return parsed;
    }
}

internal sealed class ProtocolException(string code) : Exception(code)
{
    internal string Code { get; } = code;
}

internal sealed record NativeSelfTestRequest(
    string SchemaVersion,
    string Operation,
    string SelfTestId,
    string RequestDigest,
    string EntryArtifactDigest,
    string ChallengeDigest,
    string FixtureIdentityDigest,
    DateTimeOffset IssuedAt,
    DateTimeOffset ExpiresAt,
    int MaxDurationMs);

internal sealed record NativeProbeObservation(
    bool Attempted,
    bool? OperationDenied,
    bool? SentinelControlPassed,
    bool? SentinelReached,
    int? NativeCode,
    int? ExitCode,
    uint? TotalProcesses,
    uint? ActiveProcesses,
    bool? ProfileRemoved,
    bool? FixtureRemoved);

internal sealed record NativeProbeResult(
    string Id,
    string Expected,
    string Outcome,
    string Code,
    NativeProbeObservation Observation);

internal sealed record NativeSelfTestEffects(
    bool ContainedProcessStarted,
    bool ProjectMutationPerformed,
    bool NetworkConnectionEstablished,
    bool ChildProcessStarted,
    string Cleanup);

internal sealed record NativeSelfTestReport(
    string SchemaVersion,
    string Operation,
    string SelfTestId,
    string RequestDigest,
    string EntryArtifactDigest,
    string StartedAt,
    string CompletedAt,
    int DurationMs,
    IReadOnlyList<NativeProbeResult> Probes,
    NativeSelfTestEffects Effects,
    string Outcome);

internal sealed record ProbePayloadReport(
    IReadOnlyList<NativeProbeResult> Probes,
    bool ChildProcessStarted);

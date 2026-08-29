using System.Text;
using System.Text.Json;

namespace AiGamePlaybook.WindowsContainment;

internal static class EngineRunCancellationControl
{
    internal const int MaximumWaitMs = 2_000;

    internal static string EventName(
        string runId,
        string requestDigest,
        string cancellationId) =>
        $@"Local\AiGamePlaybook.EngineRun.{Compact(runId)}.{requestDigest[7..]}.{Compact(cancellationId)}.Cancel";

    internal static EventWaitHandle Create(
        string runId,
        string requestDigest,
        string cancellationId)
    {
        var handle = new EventWaitHandle(
            false,
            EventResetMode.ManualReset,
            EventName(runId, requestDigest, cancellationId),
            out bool createdNew);
        if (!createdNew)
        {
            handle.Dispose();
            throw new InvalidOperationException("cancellation-event-collision");
        }
        return handle;
    }

    private static string Compact(string value) =>
        value.Replace("-", string.Empty, StringComparison.Ordinal);
}

internal static class EngineRunCancellationProtocol
{
    private const int MaximumInputBytes = 2 * 1024;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    internal static async Task<NativeEngineRunCancellationRequest> ReadRequestAsync()
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
                MaxDepth = 4,
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
            "runId",
            "requestDigest",
            "entryArtifactDigest",
            "cancellationId",
            "expiresAt",
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

        string schemaVersion = RequiredString(properties, "schemaVersion", 20);
        string operation = RequiredString(properties, "operation", 80);
        string runId = RequiredUuid(properties, "runId");
        string requestDigest = RequiredDigest(properties, "requestDigest");
        string entryArtifactDigest = RequiredDigest(properties, "entryArtifactDigest");
        string cancellationId = RequiredUuid(properties, "cancellationId");
        DateTimeOffset expiresAt = RequiredTimestamp(properties, "expiresAt");
        DateTimeOffset now = DateTimeOffset.UtcNow;
        long remainingMs = (long)(expiresAt - now).TotalMilliseconds;
        if (
            schemaVersion != "1.0.0"
            || operation != "godot-engine-cancel"
            || remainingMs is < 1 or > EngineRunCancellationControl.MaximumWaitMs)
        {
            throw new ProtocolException("request-value-invalid");
        }
        return new NativeEngineRunCancellationRequest(
            schemaVersion,
            operation,
            runId,
            requestDigest,
            entryArtifactDigest,
            cancellationId,
            expiresAt);
    }

    private static string RequiredString(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name,
        int maximumLength)
    {
        JsonElement value = properties[name];
        if (value.ValueKind != JsonValueKind.String)
        {
            throw new ProtocolException("request-value-invalid");
        }
        string? text = value.GetString();
        if (string.IsNullOrEmpty(text) || text.Length > maximumLength || text.Contains('\0'))
        {
            throw new ProtocolException("request-value-invalid");
        }
        return text;
    }

    private static string RequiredUuid(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        string value = RequiredString(properties, name, 36);
        if (
            !Guid.TryParseExact(value, "D", out Guid parsed)
            || parsed.ToString("D") != value)
        {
            throw new ProtocolException("request-value-invalid");
        }
        return value;
    }

    private static string RequiredDigest(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        string value = RequiredString(properties, name, 71);
        if (
            value.Length != 71
            || !value.StartsWith("sha256:", StringComparison.Ordinal)
            || value.AsSpan(7).ContainsAnyExcept("0123456789abcdef"))
        {
            throw new ProtocolException("request-value-invalid");
        }
        return value;
    }

    private static DateTimeOffset RequiredTimestamp(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        string value = RequiredString(properties, name, 24);
        if (
            value.Length != 24
            || !DateTimeOffset.TryParseExact(
                value,
                "yyyy-MM-dd'T'HH:mm:ss.fff'Z'",
                System.Globalization.CultureInfo.InvariantCulture,
                System.Globalization.DateTimeStyles.AssumeUniversal
                    | System.Globalization.DateTimeStyles.AdjustToUniversal,
                out DateTimeOffset parsed)
            || Protocol.FormatTimestamp(parsed) != value)
        {
            throw new ProtocolException("request-value-invalid");
        }
        return parsed;
    }
}

internal static class EngineRunCancellationRunner
{
    internal static async Task<NativeEngineRunCancellationResult> RunAsync(
        NativeEngineRunCancellationRequest request)
    {
        string providerExecutable = Environment.ProcessPath
            ?? throw new ProtocolException("artifact-path-unavailable");
        if (Protocol.ComputeFileDigest(providerExecutable) != request.EntryArtifactDigest)
        {
            throw new ProtocolException("artifact-digest-mismatch");
        }

        bool acknowledged = false;
        while (DateTimeOffset.UtcNow < request.ExpiresAt)
        {
            if (EventWaitHandle.TryOpenExisting(
                EngineRunCancellationControl.EventName(
                    request.RunId,
                    request.RequestDigest,
                    request.CancellationId),
                out EventWaitHandle? handle))
            {
                using (handle)
                {
                    acknowledged = handle.Set();
                }
                break;
            }
            await Task.Delay(10);
        }
        var report = new NativeEngineRunCancellationReport(
            "1.0.0",
            "godot-engine-cancel",
            request.RunId,
            request.RequestDigest,
            request.EntryArtifactDigest,
            request.CancellationId,
            acknowledged);
        return new NativeEngineRunCancellationResult(report, acknowledged ? 0 : 2);
    }
}

internal sealed record NativeEngineRunCancellationRequest(
    string SchemaVersion,
    string Operation,
    string RunId,
    string RequestDigest,
    string EntryArtifactDigest,
    string CancellationId,
    DateTimeOffset ExpiresAt);

internal sealed record NativeEngineRunCancellationReport(
    string SchemaVersion,
    string Operation,
    string RunId,
    string RequestDigest,
    string EntryArtifactDigest,
    string CancellationId,
    bool Acknowledged);

internal sealed record NativeEngineRunCancellationResult(
    NativeEngineRunCancellationReport Report,
    int ExitCode);

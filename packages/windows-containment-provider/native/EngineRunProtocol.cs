using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace AiGamePlaybook.WindowsContainment;

internal static partial class EngineRunProtocol
{
    internal const int MaximumInputBytes = 4 * 1024 * 1024;
    internal const int EngineTimeoutMs = 10_000;
    internal const int MaximumOutputBytes = 256 * 1024;
    internal const int TerminationGraceMs = 2_000;
    internal const int MaximumProcesses = 1;
    internal const int MaximumProjectFiles = 1_024;
    internal const int MaximumProjectDirectories = 1_024;
    internal const int MaximumProjectFileBytes = 16 * 1024 * 1024;
    internal const int MaximumProjectBytes = 32 * 1024 * 1024;
    internal const int MaximumProfileBytes = 64 * 1024 * 1024;
    internal const string ProfileId = "godot-headless-preflight-v1";
    internal const string ProfileDigest =
        "sha256:e378585ddf388513ec5ae6e03a1a99645f16fe8909aa86dfddba5cca645c92f7";
    internal const string InvocationDigest =
        "sha256:c6740c144e5fe945f6b586c56b84aed15a43ad2cc48f280a9615c1a872556a6f";
    internal const string PolicyDigest =
        "sha256:9279861178baa8b60e2b5e7b53c09466ab05618bda01e0e82c43a968e3f1339d";
    private const int MaximumStartValidityMs = 30_000;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);
    private static readonly HashSet<string> ReservedNames = new(
        new[]
        {
            "con", "prn", "aux", "nul",
            "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
            "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
        },
        StringComparer.OrdinalIgnoreCase);

    [GeneratedRegex("^sha256:[0-9a-f]{64}$", RegexOptions.CultureInvariant)]
    private static partial Regex DigestPattern();

    internal static async Task<NativeEngineRunRequest> ReadRequestAsync()
    {
        byte[] bytes = await ReadBoundedInputAsync();
        string text;
        try
        {
            text = StrictUtf8.GetString(bytes).TrimEnd('\r', '\n');
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
        string[] expected =
        {
            "schemaVersion",
            "operation",
            "runId",
            "cancellationId",
            "requestDigest",
            "entryArtifactDigest",
            "admissionDigest",
            "providerDescriptorDigest",
            "providerCatalogDigest",
            "policyDigest",
            "profileId",
            "profileDigest",
            "invocationDigest",
            "snapshotBindingDigest",
            "projectRootIdentityDigest",
            "projectSnapshotDigest",
            "projectManifestDigest",
            "projectFileCount",
            "projectDirectoryCount",
            "projectTotalBytes",
            "sourceProjectRoot",
            "projectDirectories",
            "projectFiles",
            "executableSnapshotDigest",
            "sourceExecutablePath",
            "sourceExecutableDigest",
            "sourceExecutableIdentityDigest",
            "sourceExecutableBytes",
            "issuedAt",
            "startDeadline",
            "engineTimeoutMs",
            "maxOutputBytes",
            "terminationGraceMs",
            "maxProcesses",
            "maxProjectFiles",
            "maxProjectDirectories",
            "maxProjectFileBytes",
            "maxProjectBytes",
            "maxProfileBytes",
        };
        Dictionary<string, JsonElement> properties = ExactObject(root, expected);

        string schemaVersion = RequiredString(properties, "schemaVersion", 20);
        string operation = RequiredString(properties, "operation", 80);
        string runId = RequiredString(properties, "runId", 36);
        string cancellationId = RequiredString(properties, "cancellationId", 36);
        string requestDigest = RequiredDigest(properties, "requestDigest");
        string entryArtifactDigest = RequiredDigest(properties, "entryArtifactDigest");
        string admissionDigest = RequiredDigest(properties, "admissionDigest");
        string providerDescriptorDigest = RequiredDigest(properties, "providerDescriptorDigest");
        string providerCatalogDigest = RequiredDigest(properties, "providerCatalogDigest");
        string policyDigest = RequiredDigest(properties, "policyDigest");
        string profileId = RequiredString(properties, "profileId", 80);
        string profileDigest = RequiredDigest(properties, "profileDigest");
        string invocationDigest = RequiredDigest(properties, "invocationDigest");
        string snapshotBindingDigest = RequiredDigest(properties, "snapshotBindingDigest");
        string projectRootIdentityDigest = RequiredDigest(properties, "projectRootIdentityDigest");
        string projectSnapshotDigest = RequiredDigest(properties, "projectSnapshotDigest");
        string projectManifestDigest = RequiredDigest(properties, "projectManifestDigest");
        int projectFileCount = RequiredInteger(properties, "projectFileCount", 1, MaximumProjectFiles);
        int projectDirectoryCount = RequiredInteger(
            properties,
            "projectDirectoryCount",
            1,
            MaximumProjectDirectories);
        int projectTotalBytes = RequiredInteger(
            properties,
            "projectTotalBytes",
            1,
            MaximumProjectBytes);
        string sourceProjectRoot = RequiredLocalAbsolutePath(properties, "sourceProjectRoot");
        IReadOnlyList<string> projectDirectories = RequiredDirectories(
            properties["projectDirectories"],
            projectDirectoryCount);
        IReadOnlyList<NativeEngineRunFile> projectFiles = RequiredFiles(
            properties["projectFiles"],
            projectFileCount,
            projectTotalBytes,
            projectDirectories);
        string executableSnapshotDigest = RequiredDigest(properties, "executableSnapshotDigest");
        string sourceExecutablePath = RequiredLocalAbsolutePath(properties, "sourceExecutablePath");
        string sourceExecutableDigest = RequiredDigest(properties, "sourceExecutableDigest");
        string sourceExecutableIdentityDigest = RequiredDigest(
            properties,
            "sourceExecutableIdentityDigest");
        int sourceExecutableBytes = RequiredInteger(
            properties,
            "sourceExecutableBytes",
            1,
            256 * 1024 * 1024);
        DateTimeOffset issuedAt = RequiredTimestamp(properties, "issuedAt");
        DateTimeOffset startDeadline = RequiredTimestamp(properties, "startDeadline");
        int engineTimeoutMs = RequiredInteger(properties, "engineTimeoutMs", 1, int.MaxValue);
        int maxOutputBytes = RequiredInteger(properties, "maxOutputBytes", 1, int.MaxValue);
        int terminationGraceMs = RequiredInteger(properties, "terminationGraceMs", 1, int.MaxValue);
        int maxProcesses = RequiredInteger(properties, "maxProcesses", 1, int.MaxValue);
        int maxProjectFiles = RequiredInteger(properties, "maxProjectFiles", 1, int.MaxValue);
        int maxProjectDirectories = RequiredInteger(
            properties,
            "maxProjectDirectories",
            1,
            int.MaxValue);
        int maxProjectFileBytes = RequiredInteger(
            properties,
            "maxProjectFileBytes",
            1,
            int.MaxValue);
        int maxProjectBytes = RequiredInteger(properties, "maxProjectBytes", 1, int.MaxValue);
        int maxProfileBytes = RequiredInteger(properties, "maxProfileBytes", 1, int.MaxValue);

        if (
            schemaVersion != "1.0.0"
            || operation != "godot-engine-run"
            || !Guid.TryParseExact(runId, "D", out Guid parsedRunId)
            || !string.Equals(parsedRunId.ToString("D"), runId, StringComparison.Ordinal)
            || !Guid.TryParseExact(cancellationId, "D", out Guid parsedCancellationId)
            || !string.Equals(
                parsedCancellationId.ToString("D"),
                cancellationId,
                StringComparison.Ordinal)
            || policyDigest != PolicyDigest
            || profileId != ProfileId
            || profileDigest != ProfileDigest
            || invocationDigest != InvocationDigest
            || engineTimeoutMs != EngineTimeoutMs
            || maxOutputBytes != MaximumOutputBytes
            || terminationGraceMs != TerminationGraceMs
            || maxProcesses != MaximumProcesses
            || maxProjectFiles != MaximumProjectFiles
            || maxProjectDirectories != MaximumProjectDirectories
            || maxProjectFileBytes != MaximumProjectFileBytes
            || maxProjectBytes != MaximumProjectBytes
            || maxProfileBytes != MaximumProfileBytes)
        {
            throw new ProtocolException("request-value-invalid");
        }
        long validityMs = (long)(startDeadline - issuedAt).TotalMilliseconds;
        DateTimeOffset now = DateTimeOffset.UtcNow;
        if (
            validityMs is < 1 or > MaximumStartValidityMs
            || now < issuedAt
            || now >= startDeadline)
        {
            throw new ProtocolException("request-window-invalid");
        }
        if (IsSameOrDescendant(sourceExecutablePath, sourceProjectRoot))
        {
            throw new ProtocolException("source-layout-invalid");
        }

        return new NativeEngineRunRequest(
            schemaVersion,
            operation,
            runId,
            cancellationId,
            requestDigest,
            entryArtifactDigest,
            admissionDigest,
            providerDescriptorDigest,
            providerCatalogDigest,
            policyDigest,
            profileId,
            profileDigest,
            invocationDigest,
            snapshotBindingDigest,
            projectRootIdentityDigest,
            projectSnapshotDigest,
            projectManifestDigest,
            projectFileCount,
            projectDirectoryCount,
            projectTotalBytes,
            sourceProjectRoot,
            projectDirectories,
            projectFiles,
            executableSnapshotDigest,
            sourceExecutablePath,
            sourceExecutableDigest,
            sourceExecutableIdentityDigest,
            sourceExecutableBytes,
            issuedAt,
            startDeadline,
            engineTimeoutMs,
            maxOutputBytes,
            terminationGraceMs,
            maxProcesses,
            maxProjectFiles,
            maxProjectDirectories,
            maxProjectFileBytes,
            maxProjectBytes,
            maxProfileBytes);
    }

    private static async Task<byte[]> ReadBoundedInputAsync()
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
        return buffer[..total];
    }

    private static Dictionary<string, JsonElement> ExactObject(
        JsonElement value,
        IReadOnlyList<string> expected)
    {
        if (value.ValueKind != JsonValueKind.Object)
        {
            throw new ProtocolException("request-shape-invalid");
        }
        var properties = new Dictionary<string, JsonElement>(StringComparer.Ordinal);
        foreach (JsonProperty property in value.EnumerateObject())
        {
            if (!properties.TryAdd(property.Name, property.Value))
            {
                throw new ProtocolException("request-duplicate-field");
            }
        }
        if (properties.Count != expected.Count || expected.Any(name => !properties.ContainsKey(name)))
        {
            throw new ProtocolException("request-shape-invalid");
        }
        return properties;
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

    private static string RequiredDigest(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        string value = RequiredString(properties, name, 71);
        if (!DigestPattern().IsMatch(value))
        {
            throw new ProtocolException("request-value-invalid");
        }
        return value;
    }

    private static int RequiredInteger(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name,
        int minimum,
        int maximum)
    {
        JsonElement value = properties[name];
        if (
            value.ValueKind != JsonValueKind.Number
            || !value.TryGetInt32(out int integer)
            || integer < minimum
            || integer > maximum)
        {
            throw new ProtocolException("request-value-invalid");
        }
        return integer;
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

    private static string RequiredLocalAbsolutePath(
        IReadOnlyDictionary<string, JsonElement> properties,
        string name)
    {
        string value = RequiredString(properties, name, 32_767);
        if (
            !Path.IsPathFullyQualified(value)
            || value.StartsWith(@"\\", StringComparison.Ordinal)
            || !string.Equals(Path.GetFullPath(value), value, StringComparison.OrdinalIgnoreCase))
        {
            throw new ProtocolException("source-path-invalid");
        }
        return value;
    }

    private static IReadOnlyList<string> RequiredDirectories(
        JsonElement value,
        int expectedCount)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != expectedCount)
        {
            throw new ProtocolException("request-shape-invalid");
        }
        var directories = new List<string>(expectedCount);
        foreach (JsonElement item in value.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.String)
            {
                throw new ProtocolException("request-value-invalid");
            }
            string? path = item.GetString();
            if (path is null || (path.Length > 0 && !ValidRelativePath(path)))
            {
                throw new ProtocolException("source-path-invalid");
            }
            directories.Add(path);
        }
        if (
            directories.Count == 0
            || directories[0] != string.Empty
            || !IsStrictlySorted(directories)
            || directories.Distinct(StringComparer.OrdinalIgnoreCase).Count() != directories.Count)
        {
            throw new ProtocolException("source-manifest-invalid");
        }
        return directories.AsReadOnly();
    }

    private static IReadOnlyList<NativeEngineRunFile> RequiredFiles(
        JsonElement value,
        int expectedCount,
        int expectedTotalBytes,
        IReadOnlyList<string> directories)
    {
        if (value.ValueKind != JsonValueKind.Array || value.GetArrayLength() != expectedCount)
        {
            throw new ProtocolException("request-shape-invalid");
        }
        var files = new List<NativeEngineRunFile>(expectedCount);
        long totalBytes = 0;
        foreach (JsonElement item in value.EnumerateArray())
        {
            Dictionary<string, JsonElement> properties = ExactObject(
                item,
                new[] { "path", "digest", "bytes" });
            string path = RequiredString(properties, "path", 32_767);
            if (!ValidRelativePath(path))
            {
                throw new ProtocolException("source-path-invalid");
            }
            string digest = RequiredDigest(properties, "digest");
            int bytes = RequiredInteger(properties, "bytes", 0, MaximumProjectFileBytes);
            totalBytes += bytes;
            files.Add(new NativeEngineRunFile(path, digest, bytes));
        }
        var portableKeys = new HashSet<string>(directories, StringComparer.OrdinalIgnoreCase);
        foreach (NativeEngineRunFile file in files)
        {
            if (!portableKeys.Add(file.Path))
            {
                throw new ProtocolException("source-manifest-invalid");
            }
            string? parent = ParentPath(file.Path);
            if (parent is not null && !portableKeys.Contains(parent))
            {
                throw new ProtocolException("source-manifest-invalid");
            }
        }
        foreach (string directory in directories.Skip(1))
        {
            string? parent = ParentPath(directory);
            if (parent is null || !portableKeys.Contains(parent))
            {
                throw new ProtocolException("source-manifest-invalid");
            }
        }
        if (
            totalBytes != expectedTotalBytes
            || !IsStrictlySorted(files.Select(file => file.Path).ToArray()))
        {
            throw new ProtocolException("source-manifest-invalid");
        }
        return files.AsReadOnly();
    }

    private static bool IsStrictlySorted(IReadOnlyList<string> values)
    {
        for (int index = 1; index < values.Count; index += 1)
        {
            if (StringComparer.Ordinal.Compare(values[index - 1], values[index]) >= 0)
            {
                return false;
            }
        }
        return true;
    }

    private static bool ValidRelativePath(string value)
    {
        if (
            value.Length is < 1 or > 32_767
            || Encoding.UTF8.GetByteCount(value) > 32_767
            || value != value.Normalize(NormalizationForm.FormC)
            || value.Contains('\\')
            || value.Contains(':')
            || value.Any(character => character is < ' ' or '\u007f'))
        {
            return false;
        }
        string[] segments = value.Split('/');
        return segments.All(ValidSegment);
    }

    private static bool ValidSegment(string segment)
    {
        if (
            segment.Length is < 1 or > 255
            || segment is "." or ".."
            || segment.EndsWith('.')
            || segment.EndsWith(' '))
        {
            return false;
        }
        string stem = segment.Split('.')[0];
        return !ReservedNames.Contains(stem);
    }

    private static string? ParentPath(string value)
    {
        int separator = value.LastIndexOf('/');
        return separator < 0 ? string.Empty : value[..separator];
    }

    private static bool IsSameOrDescendant(string candidate, string root)
    {
        string normalizedRoot = root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar;
        return string.Equals(candidate, root, StringComparison.OrdinalIgnoreCase)
            || candidate.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase);
    }
}

internal sealed record NativeEngineRunFile(string Path, string Digest, int Bytes);

internal sealed record NativeEngineRunRequest(
    string SchemaVersion,
    string Operation,
    string RunId,
    string CancellationId,
    string RequestDigest,
    string EntryArtifactDigest,
    string AdmissionDigest,
    string ProviderDescriptorDigest,
    string ProviderCatalogDigest,
    string PolicyDigest,
    string ProfileId,
    string ProfileDigest,
    string InvocationDigest,
    string SnapshotBindingDigest,
    string ProjectRootIdentityDigest,
    string ProjectSnapshotDigest,
    string ProjectManifestDigest,
    int ProjectFileCount,
    int ProjectDirectoryCount,
    int ProjectTotalBytes,
    string SourceProjectRoot,
    IReadOnlyList<string> ProjectDirectories,
    IReadOnlyList<NativeEngineRunFile> ProjectFiles,
    string ExecutableSnapshotDigest,
    string SourceExecutablePath,
    string SourceExecutableDigest,
    string SourceExecutableIdentityDigest,
    int SourceExecutableBytes,
    DateTimeOffset IssuedAt,
    DateTimeOffset StartDeadline,
    int EngineTimeoutMs,
    int MaxOutputBytes,
    int TerminationGraceMs,
    int MaxProcesses,
    int MaxProjectFiles,
    int MaxProjectDirectories,
    int MaxProjectFileBytes,
    int MaxProjectBytes,
    int MaxProfileBytes);

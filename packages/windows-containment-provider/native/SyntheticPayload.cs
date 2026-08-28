using System.Text;
using System.Text.Json;

namespace AiGamePlaybook.WindowsContainment;

internal static class SyntheticPayload
{
    internal static async Task<int> RunAsync(string[] args)
    {
        if (!WindowsProcess.IsCurrentProcessAppContainer())
        {
            throw new ProtocolException("synthetic-workload-appcontainer-required");
        }
        IReadOnlyDictionary<string, string> parsed = ParseArguments(args);
        string project = FullLocalPath(parsed["project"]);
        string report = FullLocalPath(parsed["report"]);
        string profileRoot = FullLocalPath(
            WindowsProcess.GetCurrentAppContainerProfileRoot());
        string expectedReportRoot = Path.GetFullPath(Path.Combine(profileRoot, "LocalState"));
        string? reportRoot = Path.GetDirectoryName(report);
        if (!string.Equals(reportRoot, expectedReportRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new ProtocolException("synthetic-workload-report-boundary-invalid");
        }
        AssertNotReparsePoint(project);
        AssertNotReparsePoint(expectedReportRoot);

        string sentinel = Path.Combine(project, "sentinel.txt");
        string[] entries = Directory.EnumerateFileSystemEntries(
            project,
            "*",
            SearchOption.TopDirectoryOnly).ToArray();
        if (
            entries.Length != 1
            || !string.Equals(
                Path.GetFullPath(entries[0]),
                Path.GetFullPath(sentinel),
                StringComparison.OrdinalIgnoreCase))
        {
            throw new ProtocolException("synthetic-workload-project-shape-invalid");
        }
        AssertNotReparsePoint(sentinel);
        if (Protocol.ComputeFileDigest(sentinel) != parsed["project-manifest-digest"])
        {
            throw new ProtocolException("synthetic-workload-project-digest-mismatch");
        }
        string executable = Environment.ProcessPath
            ?? throw new ProtocolException("artifact-path-unavailable");
        if (Protocol.ComputeFileDigest(executable) != parsed["entry-artifact-digest"])
        {
            throw new ProtocolException("artifact-digest-mismatch");
        }

        var output = new SyntheticWorkloadOutput(
            parsed["challenge-digest"],
            parsed["entry-artifact-digest"],
            parsed["executable-snapshot-digest"],
            parsed["project-manifest-digest"],
            parsed["project-root-identity-digest"],
            parsed["project-snapshot-digest"],
            "1.0.0",
            "succeeded");
        string text = JsonSerializer.Serialize(output, Protocol.JsonOptions);
        if (Protocol.ComputeTextDigest(text) != parsed["expected-output-digest"])
        {
            throw new ProtocolException("synthetic-workload-output-digest-mismatch");
        }
        await using var stream = new FileStream(
            report,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            16 * 1024,
            FileOptions.Asynchronous | FileOptions.WriteThrough);
        byte[] content = new UTF8Encoding(false, true).GetBytes(text);
        await stream.WriteAsync(content);
        await stream.FlushAsync();
        return 0;
    }

    private static IReadOnlyDictionary<string, string> ParseArguments(string[] args)
    {
        string[] required =
        {
            "project",
            "report",
            "challenge-digest",
            "entry-artifact-digest",
            "executable-snapshot-digest",
            "project-manifest-digest",
            "project-root-identity-digest",
            "project-snapshot-digest",
            "expected-output-digest",
        };
        if (args.Length != required.Length * 2)
        {
            throw new ProtocolException("synthetic-workload-arguments-invalid");
        }
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int index = 0; index < args.Length; index += 2)
        {
            string key = args[index];
            string value = args[index + 1];
            if (
                !key.StartsWith("--", StringComparison.Ordinal)
                || value.Length == 0
                || value.Length > 32_767
                || value.Contains('\0')
                || !result.TryAdd(key[2..], value))
            {
                throw new ProtocolException("synthetic-workload-arguments-invalid");
            }
        }
        if (required.Any(key => !result.ContainsKey(key)))
        {
            throw new ProtocolException("synthetic-workload-arguments-invalid");
        }
        foreach (string key in required.Where(key => key.EndsWith("-digest", StringComparison.Ordinal)))
        {
            if (!Protocol.IsDigest(result[key]))
            {
                throw new ProtocolException("synthetic-workload-digest-invalid");
            }
        }
        return result;
    }

    private static string FullLocalPath(string value)
    {
        if (!Path.IsPathFullyQualified(value) || value.StartsWith(@"\\", StringComparison.Ordinal))
        {
            throw new ProtocolException("synthetic-workload-path-invalid");
        }
        return Path.GetFullPath(value);
    }

    private static void AssertNotReparsePoint(string path)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            throw new ProtocolException("synthetic-workload-reparse-point-rejected");
        }
    }
}

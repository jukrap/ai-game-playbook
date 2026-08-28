using System.ComponentModel;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.Json;

namespace AiGamePlaybook.WindowsContainment;

internal static class ProbePayload
{
    internal static async Task<int> RunAsync(string[] args)
    {
        IReadOnlyDictionary<string, string> parsed = ParseArguments(args);
        string project = parsed["project"];
        string alias = parsed["alias"];
        string report = parsed["report"];
        int ipv4Port = ParsePort(parsed["ipv4-port"]);
        int ipv6Port = ParsePort(parsed["ipv6-port"]);
        int dnsPort = ParsePort(parsed["dns-port"]);
        string dnsName = parsed["dns-name"];
        var probes = new List<NativeProbeResult>
        {
            Result("workload-start", "allowed", true, "started", Observation(attempted: true)),
        };

        probes.Add(ExpectDenied("project-create", () =>
            File.WriteAllText(Path.Combine(project, "created.txt"), "x")));

        string writableRoot = Path.GetDirectoryName(report)
            ?? throw new InvalidOperationException("report-directory-unavailable");
        string writableSource = Path.Combine(writableRoot, "replacement.txt");
        await File.WriteAllTextAsync(writableSource, "replacement");
        probes.Add(ExpectDenied("project-replace", () =>
            File.Copy(writableSource, Path.Combine(project, "sentinel.txt"), overwrite: true)));
        probes.Add(ExpectDenied("project-remove", () =>
            File.Delete(Path.Combine(project, "sentinel.txt"))));
        probes.Add(ExpectDenied("project-rename", () =>
            File.Move(Path.Combine(project, "sentinel.txt"), Path.Combine(project, "renamed.txt"))));
        probes.Add(ExpectDenied("project-alias-write", () =>
            File.WriteAllText(alias, "alias mutation")));

        probes.Add(await ExpectTcpDeniedAsync(
            "network-ipv4-connect",
            AddressFamily.InterNetwork,
            IPAddress.Loopback,
            ipv4Port));
        probes.Add(await ExpectTcpDeniedAsync(
            "network-ipv6-connect",
            AddressFamily.InterNetworkV6,
            IPAddress.IPv6Loopback,
            ipv6Port));
        probes.Add(await ExpectDnsDeniedAsync(dnsName, dnsPort));

        NativeProbeResult child = ExpectChildDenied("child-process-spawn", detached: false);
        probes.Add(child);
        NativeProbeResult detached = ExpectChildDenied("detached-child-process-spawn", detached: true);
        probes.Add(detached);

        bool childProcessStarted = child.Code == "child-created" || detached.Code == "child-created";
        var payload = new ProbePayloadReport(probes, childProcessStarted);
        await File.WriteAllTextAsync(report, JsonSerializer.Serialize(payload, Protocol.JsonOptions));
        return probes.All(item => item.Outcome == "passed") ? 0 : 3;
    }

    private static IReadOnlyDictionary<string, string> ParseArguments(string[] args)
    {
        string[] required =
        {
            "project",
            "alias",
            "report",
            "ipv4-port",
            "ipv6-port",
            "dns-port",
            "dns-name",
        };
        if (args.Length != required.Length * 2)
        {
            throw new ArgumentException("probe-arguments-invalid");
        }
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        for (int index = 0; index < args.Length; index += 2)
        {
            string key = args[index];
            string value = args[index + 1];
            if (
                !key.StartsWith("--", StringComparison.Ordinal)
                || value.Length == 0
                || value.Contains('\0')
                || !result.TryAdd(key[2..], value))
            {
                throw new ArgumentException("probe-arguments-invalid");
            }
        }
        if (required.Any(key => !result.ContainsKey(key)))
        {
            throw new ArgumentException("probe-arguments-invalid");
        }
        foreach (string key in new[] { "project", "alias", "report" })
        {
            if (!Path.IsPathFullyQualified(result[key]))
            {
                throw new ArgumentException("probe-path-invalid");
            }
        }
        return result;
    }

    private static int ParsePort(string value)
    {
        if (!int.TryParse(value, out int port) || port is < 1 or > 65535)
        {
            throw new ArgumentException("probe-port-invalid");
        }
        return port;
    }

    private static NativeProbeResult ExpectDenied(string id, Action action)
    {
        try
        {
            action();
            return Result(id, "denied", false, "operation-succeeded", Observation(attempted: true, operationDenied: false));
        }
        catch (UnauthorizedAccessException)
        {
            return Result(id, "denied", true, "access-denied", Observation(attempted: true, operationDenied: true, nativeCode: 5));
        }
        catch (IOException error) when (error.HResult == unchecked((int)0x80070005))
        {
            return Result(id, "denied", true, "access-denied", Observation(attempted: true, operationDenied: true, nativeCode: 5));
        }
        catch (Exception error)
        {
            return Result(id, "denied", false, $"unexpected-{error.GetType().Name}", Observation(attempted: true));
        }
    }

    private static async Task<NativeProbeResult> ExpectTcpDeniedAsync(
        string id,
        AddressFamily family,
        IPAddress address,
        int port)
    {
        using var socket = new Socket(family, SocketType.Stream, ProtocolType.Tcp);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            await socket.ConnectAsync(new IPEndPoint(address, port), timeout.Token);
            return Result(id, "denied", false, "connection-established", Observation(attempted: true, operationDenied: false));
        }
        catch (SocketException error) when (error.SocketErrorCode == SocketError.AccessDenied)
        {
            return Result(id, "denied", true, "access-denied", Observation(attempted: true, operationDenied: true, nativeCode: (int)error.SocketErrorCode));
        }
        catch (OperationCanceledException)
        {
            return Result(id, "denied", true, "not-established-before-timeout", Observation(attempted: true, operationDenied: true));
        }
        catch (Exception error)
        {
            return Result(id, "denied", false, $"unexpected-{error.GetType().Name}", Observation(attempted: true));
        }
    }

    private static async Task<NativeProbeResult> ExpectDnsDeniedAsync(string name, int port)
    {
        using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Dgram, ProtocolType.Udp);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(2));
        try
        {
            byte[] query = BuildDnsQuery(name);
            int sent = await socket.SendToAsync(
                query,
                SocketFlags.None,
                new IPEndPoint(IPAddress.Loopback, port),
                timeout.Token);
            return Result(
                "network-name-resolution",
                "denied",
                true,
                sent == query.Length ? "query-issued" : "query-partial",
                Observation(attempted: true, operationDenied: false));
        }
        catch (SocketException error) when (error.SocketErrorCode == SocketError.AccessDenied)
        {
            return Result(
                "network-name-resolution",
                "denied",
                true,
                "access-denied",
                Observation(attempted: true, operationDenied: true, nativeCode: (int)error.SocketErrorCode));
        }
        catch (OperationCanceledException)
        {
            return Result(
                "network-name-resolution",
                "denied",
                true,
                "not-established-before-timeout",
                Observation(attempted: true, operationDenied: true));
        }
        catch (Exception error)
        {
            return Result(
                "network-name-resolution",
                "denied",
                false,
                $"unexpected-{error.GetType().Name}",
                Observation(attempted: true));
        }
    }

    private static NativeProbeResult ExpectChildDenied(string id, bool detached)
    {
        string executable = Environment.ProcessPath
            ?? throw new InvalidOperationException("process-path-unavailable");
        var command = new StringBuilder(WindowsProcess.BuildCommandLine(new[] { executable, "noop" }));
        NativeMethods.STARTUPINFO startup = new()
        {
            cb = Marshal.SizeOf<NativeMethods.STARTUPINFO>(),
        };
        uint flags = NativeMethods.CreateNoWindow
            | (detached ? NativeMethods.DetachedProcess | NativeMethods.CreateNewProcessGroup : 0);
        bool created = NativeMethods.CreateProcessBasic(
            executable,
            command,
            IntPtr.Zero,
            IntPtr.Zero,
            false,
            flags,
            IntPtr.Zero,
            null,
            ref startup,
            out NativeMethods.PROCESS_INFORMATION info);
        if (created)
        {
            NativeMethods.TerminateProcess(info.hProcess, 125);
            NativeMethods.WaitForSingleObject(info.hProcess, 2_000);
            NativeMethods.CloseHandle(info.hThread);
            NativeMethods.CloseHandle(info.hProcess);
            return Result(id, "denied", false, "child-created", Observation(attempted: true, operationDenied: false));
        }
        int code = Marshal.GetLastWin32Error();
        bool denied = code is 5 or 367;
        return Result(
            id,
            "denied",
            denied,
            denied ? (code == 367 ? "child-process-blocked" : "access-denied") : $"unexpected-win32-{code}",
            Observation(attempted: true, operationDenied: denied, nativeCode: code));
    }

    private static byte[] BuildDnsQuery(string name)
    {
        var query = new List<byte>
        {
            0x12, 0x34,
            0x01, 0x00,
            0x00, 0x01,
            0x00, 0x00,
            0x00, 0x00,
            0x00, 0x00,
        };
        foreach (string label in name.Split('.', StringSplitOptions.RemoveEmptyEntries))
        {
            byte[] encoded = Encoding.ASCII.GetBytes(label);
            if (encoded.Length is 0 or > 63)
            {
                throw new ArgumentException("dns-label-invalid");
            }
            query.Add((byte)encoded.Length);
            query.AddRange(encoded);
        }
        query.Add(0x00);
        query.AddRange(new byte[] { 0x00, 0x01, 0x00, 0x01 });
        return query.ToArray();
    }

    internal static NativeProbeObservation Observation(
        bool attempted,
        bool? operationDenied = null,
        bool? sentinelControlPassed = null,
        bool? sentinelReached = null,
        int? nativeCode = null,
        int? exitCode = null,
        uint? totalProcesses = null,
        uint? activeProcesses = null,
        bool? profileRemoved = null,
        bool? fixtureRemoved = null) =>
        new(
            attempted,
            operationDenied,
            sentinelControlPassed,
            sentinelReached,
            nativeCode,
            exitCode,
            totalProcesses,
            activeProcesses,
            profileRemoved,
            fixtureRemoved);

    internal static NativeProbeResult Result(
        string id,
        string expected,
        bool passed,
        string code,
        NativeProbeObservation observation) =>
        new(id, expected, passed ? "passed" : "failed", code, observation);
}

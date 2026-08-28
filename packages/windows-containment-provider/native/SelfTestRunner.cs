using System.ComponentModel;
using System.Net;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace AiGamePlaybook.WindowsContainment;

internal static class SelfTestRunner
{
    private static readonly (string Id, string Expected)[] OrderedProbes =
    {
        ("workload-start", "allowed"),
        ("project-create", "denied"),
        ("project-replace", "denied"),
        ("project-remove", "denied"),
        ("project-rename", "denied"),
        ("project-alias-write", "denied"),
        ("network-ipv4-connect", "denied"),
        ("network-ipv6-connect", "denied"),
        ("network-name-resolution", "denied"),
        ("child-process-spawn", "denied"),
        ("detached-child-process-spawn", "denied"),
        ("termination-cleanup", "complete"),
    };

    internal static async Task<NativeRunResult> RunAsync(NativeSelfTestRequest request)
    {
        DateTimeOffset started = Protocol.TruncateToMilliseconds(DateTimeOffset.UtcNow);
        string executable = Environment.ProcessPath
            ?? throw new ProtocolException("artifact-path-unavailable");
        using FileStream artifactStream = new(
            executable,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            128 * 1024,
            FileOptions.SequentialScan);
        string observedArtifactDigest = Protocol.ComputeStreamDigest(artifactStream);
        if (!string.Equals(observedArtifactDigest, request.EntryArtifactDigest, StringComparison.Ordinal))
        {
            throw new ProtocolException("artifact-digest-mismatch");
        }

        string compactId = request.SelfTestId.Replace("-", string.Empty, StringComparison.Ordinal);
        string profileName = $"AiGamePlaybook.Containment.{compactId}";
        string ownedRoot = Path.Combine(Path.GetTempPath(), $"agpb-containment-{compactId}");
        string fixtureRoot = Path.Combine(ownedRoot, "fixture");
        string projectRoot = Path.Combine(fixtureRoot, "project");
        string aliasRoot = Path.Combine(fixtureRoot, "alias");
        string sentinelPath = Path.Combine(projectRoot, "sentinel.txt");
        string aliasPath = Path.Combine(aliasRoot, "sentinel-link.txt");
        string probePath = Path.Combine(fixtureRoot, "probe.exe");

        IntPtr appContainerSid = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr process = IntPtr.Zero;
        IntPtr thread = IntPtr.Zero;
        bool profileCreated = false;
        bool profileRemoved = false;
        bool fixtureCreated = false;
        bool fixtureRemoved = false;
        bool processStarted = false;
        bool processAssignedToJob = false;
        bool timedOut = false;
        bool terminationUncertain = false;
        bool projectMutation = true;
        bool redirectedMutation = true;
        bool sentinelControlPassed = false;
        bool ipv4Reached = false;
        bool ipv6Reached = false;
        bool dnsReached = false;
        int processExitCode = -1;
        string failureCode = "probe-report-unavailable";
        JobAccounting? accounting = null;
        ProbePayloadReport? payload = null;
        TcpListener? ipv4 = null;
        TcpListener? ipv6 = null;
        UdpClient? dns = null;

        try
        {
            if (Directory.Exists(ownedRoot) || File.Exists(ownedRoot))
            {
                throw new InvalidOperationException("owned-root-collision");
            }
            fixtureCreated = true;
            Directory.CreateDirectory(projectRoot);
            Directory.CreateDirectory(aliasRoot);
            string sentinelContent = $"original\n{request.FixtureIdentityDigest}\n{request.ChallengeDigest}\n";
            File.WriteAllText(sentinelPath, sentinelContent, new UTF8Encoding(false));
            if (!NativeMethods.CreateHardLink(aliasPath, sentinelPath, IntPtr.Zero))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "hard-link-create-failed");
            }
            await using (FileStream probeStream = new(
                probePath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                128 * 1024,
                FileOptions.SequentialScan))
            {
                artifactStream.Position = 0;
                await artifactStream.CopyToAsync(probeStream);
                await probeStream.FlushAsync();
            }

            ipv4 = new TcpListener(IPAddress.Loopback, 0);
            ipv6 = new TcpListener(IPAddress.IPv6Loopback, 0);
            dns = new UdpClient(new IPEndPoint(IPAddress.Loopback, 53));
            ipv4.Start(1);
            ipv6.Server.DualMode = false;
            ipv6.Start(1);
            await VerifyTcpSentinelAsync(ipv4);
            await VerifyTcpSentinelAsync(ipv6);
            await VerifyUdpSentinelAsync(dns);
            sentinelControlPassed = true;

            int profileResult = NativeMethods.CreateAppContainerProfile(
                profileName,
                profileName,
                "AI Game Playbook disposable containment verification",
                IntPtr.Zero,
                0,
                out appContainerSid);
            if (profileResult != 0)
            {
                Marshal.ThrowExceptionForHR(profileResult);
            }
            profileCreated = true;
            var sid = new SecurityIdentifier(appContainerSid);
            WindowsProcess.GrantReadExecute(fixtureRoot, sid);
            string profileRoot = WindowsProcess.GetProfileRoot(sid.Value);
            string profileState = Path.Combine(profileRoot, "LocalState");
            string profileTemp = Path.Combine(profileRoot, "TempState");
            Directory.CreateDirectory(profileState);
            Directory.CreateDirectory(profileTemp);
            string probeReportPath = Path.Combine(profileState, "probe-report.json");

            job = NativeMethods.CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "job-create-failed");
            }
            WindowsProcess.ConfigureJob(job);

            int ipv4Port = ((IPEndPoint)ipv4.LocalEndpoint).Port;
            int ipv6Port = ((IPEndPoint)ipv6.LocalEndpoint).Port;
            string[] command =
            {
                probePath,
                "probe",
                "--project", projectRoot,
                "--alias", aliasPath,
                "--report", probeReportPath,
                "--ipv4-port", ipv4Port.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "--ipv6-port", ipv6Port.ToString(System.Globalization.CultureInfo.InvariantCulture),
                "--dns-port", "53",
                "--dns-name", $"{compactId}.invalid",
            };
            IReadOnlyDictionary<string, string> environment =
                WindowsProcess.BuildContainedEnvironment(profileRoot, profileTemp);
            (process, thread) = WindowsProcess.CreateContainedProcess(
                probePath,
                WindowsProcess.BuildCommandLine(command),
                projectRoot,
                WindowsProcess.BuildEnvironmentBlock(environment),
                appContainerSid);
            processStarted = true;
            if (!NativeMethods.AssignProcessToJobObject(job, process))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "job-assignment-failed");
            }
            processAssignedToJob = true;
            if (NativeMethods.ResumeThread(thread) == uint.MaxValue)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "process-resume-failed");
            }

            int remainingMs = (int)Math.Clamp(
                (request.ExpiresAt - DateTimeOffset.UtcNow).TotalMilliseconds - 5_000,
                1,
                20_000);
            uint wait = NativeMethods.WaitForSingleObject(process, (uint)remainingMs);
            if (wait == NativeMethods.WaitTimeout)
            {
                timedOut = true;
                failureCode = "contained-process-timeout";
                if (!NativeMethods.TerminateJobObject(job, 124))
                {
                    terminationUncertain = true;
                }
                wait = NativeMethods.WaitForSingleObject(process, 2_000);
            }
            if (wait != NativeMethods.WaitObject0)
            {
                terminationUncertain = true;
                throw new Win32Exception(Marshal.GetLastWin32Error(), "contained-process-wait-unconfirmed");
            }
            if (!NativeMethods.GetExitCodeProcess(process, out uint nativeExitCode))
            {
                terminationUncertain = true;
                throw new Win32Exception(Marshal.GetLastWin32Error(), "contained-process-exit-unavailable");
            }
            processExitCode = unchecked((int)nativeExitCode);
            accounting = WindowsProcess.QueryJobAccounting(job);
            if (File.Exists(probeReportPath))
            {
                var reportFile = new FileInfo(probeReportPath);
                if (reportFile.Length is > 0 and <= 64 * 1024)
                {
                    payload = JsonSerializer.Deserialize<ProbePayloadReport>(
                        await File.ReadAllTextAsync(probeReportPath),
                        Protocol.JsonOptions);
                }
            }

            projectMutation = !File.Exists(sentinelPath)
                || File.ReadAllText(sentinelPath) != sentinelContent
                || File.Exists(Path.Combine(projectRoot, "created.txt"))
                || File.Exists(Path.Combine(projectRoot, "renamed.txt"));
            redirectedMutation = Directory
                .EnumerateFiles(profileRoot, "*", SearchOption.AllDirectories)
                .Any(path => new[] { "created.txt", "renamed.txt", "sentinel.txt", "sentinel-link.txt" }
                    .Contains(Path.GetFileName(path), StringComparer.OrdinalIgnoreCase));
            await Task.Delay(100);
            failureCode = payload is null ? "probe-report-unavailable" : "probe-completed";
        }
        catch (Exception error)
        {
            failureCode = FailureCode(error);
        }
        finally
        {
            if (process != IntPtr.Zero)
            {
                uint wait = NativeMethods.WaitForSingleObject(process, 0);
                if (wait == NativeMethods.WaitTimeout)
                {
                    bool terminated = processAssignedToJob && job != IntPtr.Zero
                        ? NativeMethods.TerminateJobObject(job, 124)
                        : NativeMethods.TerminateProcess(process, 124);
                    if (!terminated || NativeMethods.WaitForSingleObject(process, 2_000) != NativeMethods.WaitObject0)
                    {
                        terminationUncertain = true;
                    }
                }
            }
            if (job != IntPtr.Zero)
            {
                try
                {
                    accounting = WindowsProcess.QueryJobAccounting(job);
                }
                catch
                {
                    terminationUncertain = true;
                }
            }
            if (ipv4 is not null)
            {
                try
                {
                    ipv4Reached = ListenerHasPendingConnection(ipv4);
                }
                catch
                {
                    ipv4Reached = true;
                    terminationUncertain = true;
                }
                ipv4.Stop();
            }
            if (ipv6 is not null)
            {
                try
                {
                    ipv6Reached = ListenerHasPendingConnection(ipv6);
                }
                catch
                {
                    ipv6Reached = true;
                    terminationUncertain = true;
                }
                ipv6.Stop();
            }
            if (dns is not null)
            {
                try
                {
                    dnsReached = dns.Available > 0;
                }
                catch
                {
                    terminationUncertain = true;
                }
                dns.Dispose();
            }
            if (thread != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(thread);
            }
            if (process != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(process);
            }
            if (job != IntPtr.Zero)
            {
                NativeMethods.CloseHandle(job);
            }
            if (profileCreated)
            {
                profileRemoved = NativeMethods.DeleteAppContainerProfile(profileName) == 0;
            }
            if (appContainerSid != IntPtr.Zero)
            {
                NativeMethods.FreeSid(appContainerSid);
            }
            if (fixtureCreated)
            {
                fixtureRemoved = DeleteOwnedFixture(ownedRoot);
            }
        }

        bool activeProcessesClear = accounting is not null && accounting.ActiveProcesses == 0;
        bool cleanupComplete = profileRemoved && fixtureRemoved && activeProcessesClear && !terminationUncertain;
        IReadOnlyList<NativeProbeResult> probes = BuildFinalProbes(
            payload,
            failureCode,
            processExitCode,
            accounting,
            projectMutation || redirectedMutation,
            sentinelControlPassed,
            ipv4Reached,
            ipv6Reached,
            dnsReached,
            profileRemoved,
            fixtureRemoved,
            cleanupComplete,
            timedOut,
            terminationUncertain);
        bool childStarted = (accounting?.TotalProcesses ?? 0) > 1
            || (payload?.ChildProcessStarted ?? false);
        var effects = new NativeSelfTestEffects(
            processStarted,
            projectMutation || redirectedMutation,
            ipv4Reached || ipv6Reached || dnsReached,
            childStarted,
            cleanupComplete ? "complete" : terminationUncertain ? "uncertain" : "incomplete");
        bool verified = probes.All(probe => probe.Outcome == "passed")
            && effects.ContainedProcessStarted
            && !effects.ProjectMutationPerformed
            && !effects.NetworkConnectionEstablished
            && !effects.ChildProcessStarted
            && effects.Cleanup == "complete";

        DateTimeOffset completed = Protocol.TruncateToMilliseconds(DateTimeOffset.UtcNow);
        if (completed <= started)
        {
            completed = started.AddMilliseconds(1);
        }
        int durationMs = checked((int)(completed - started).TotalMilliseconds);
        if (durationMs > request.MaxDurationMs || completed > request.ExpiresAt)
        {
            verified = false;
        }
        var report = new NativeSelfTestReport(
            "1.0.0",
            "self-test",
            request.SelfTestId,
            request.RequestDigest,
            observedArtifactDigest,
            Protocol.FormatTimestamp(started),
            Protocol.FormatTimestamp(completed),
            durationMs,
            probes,
            effects,
            verified ? "verified" : "rejected");
        return new NativeRunResult(report, verified ? 0 : 2);
    }

    private static IReadOnlyList<NativeProbeResult> BuildFinalProbes(
        ProbePayloadReport? payload,
        string failureCode,
        int exitCode,
        JobAccounting? accounting,
        bool projectMutation,
        bool sentinelControlPassed,
        bool ipv4Reached,
        bool ipv6Reached,
        bool dnsReached,
        bool profileRemoved,
        bool fixtureRemoved,
        bool cleanupComplete,
        bool timedOut,
        bool terminationUncertain)
    {
        var output = new List<NativeProbeResult>(OrderedProbes.Length);
        bool payloadShapeValid = payload is not null
            && payload.Probes.Count == OrderedProbes.Length - 1
            && payload.Probes.Select(item => (item.Id, item.Expected))
                .SequenceEqual(OrderedProbes.Take(OrderedProbes.Length - 1));
        if (!payloadShapeValid)
        {
            for (int index = 0; index < OrderedProbes.Length - 1; index += 1)
            {
                (string id, string expected) = OrderedProbes[index];
                output.Add(new NativeProbeResult(
                    id,
                    expected,
                    index == 0 ? "failed" : "unavailable",
                    timedOut ? "contained-process-timeout" : failureCode,
                    ProbePayload.Observation(
                        attempted: false,
                        exitCode: exitCode,
                        totalProcesses: accounting?.TotalProcesses,
                        activeProcesses: accounting?.ActiveProcesses)));
            }
        }
        else
        {
            foreach (NativeProbeResult original in payload!.Probes)
            {
                bool passed = original.Outcome == "passed";
                string code = original.Code;
                NativeProbeObservation observation = original.Observation;
                if (original.Id == "workload-start")
                {
                    passed = passed && exitCode == 0 && !timedOut && !terminationUncertain;
                    observation = observation with
                    {
                        ExitCode = exitCode,
                        TotalProcesses = accounting?.TotalProcesses,
                        ActiveProcesses = accounting?.ActiveProcesses,
                    };
                }
                else if (original.Id.StartsWith("project-", StringComparison.Ordinal) && projectMutation)
                {
                    passed = false;
                    code = "project-mutation-observed";
                }
                else if (original.Id is "network-ipv4-connect" or "network-ipv6-connect" or "network-name-resolution")
                {
                    bool reached = original.Id switch
                    {
                        "network-ipv4-connect" => ipv4Reached,
                        "network-ipv6-connect" => ipv6Reached,
                        _ => dnsReached,
                    };
                    passed = passed && sentinelControlPassed && !reached;
                    code = reached ? "sentinel-reached" : code;
                    observation = observation with
                    {
                        SentinelControlPassed = sentinelControlPassed,
                        SentinelReached = reached,
                    };
                }
                else if (original.Id is "child-process-spawn" or "detached-child-process-spawn")
                {
                    passed = passed && (accounting?.TotalProcesses ?? uint.MaxValue) == 1;
                    observation = observation with
                    {
                        TotalProcesses = accounting?.TotalProcesses,
                        ActiveProcesses = accounting?.ActiveProcesses,
                    };
                }
                output.Add(original with
                {
                    Outcome = passed ? "passed" : "failed",
                    Code = code,
                    Observation = observation,
                });
            }
        }
        output.Add(new NativeProbeResult(
            "termination-cleanup",
            "complete",
            cleanupComplete ? "passed" : terminationUncertain ? "uncertain" : "failed",
            cleanupComplete ? "cleanup-complete" : terminationUncertain ? "cleanup-uncertain" : "cleanup-incomplete",
            ProbePayload.Observation(
                attempted: true,
                totalProcesses: accounting?.TotalProcesses,
                activeProcesses: accounting?.ActiveProcesses,
                profileRemoved: profileRemoved,
                fixtureRemoved: fixtureRemoved)));
        return output;
    }

    private static async Task VerifyTcpSentinelAsync(TcpListener listener)
    {
        var endpoint = (IPEndPoint)listener.LocalEndpoint;
        using var sender = new TcpClient(endpoint.AddressFamily);
        Task<TcpClient> accept = listener.AcceptTcpClientAsync();
        await sender.ConnectAsync(endpoint.Address, endpoint.Port);
        using TcpClient received = await accept.WaitAsync(TimeSpan.FromSeconds(2));
    }

    private static async Task VerifyUdpSentinelAsync(UdpClient listener)
    {
        var endpoint = (IPEndPoint)listener.Client.LocalEndPoint!;
        using var sender = new UdpClient(AddressFamily.InterNetwork);
        byte[] control = { 0x41, 0x47, 0x50, 0x42 };
        await sender.SendAsync(control, endpoint);
        UdpReceiveResult received = await listener.ReceiveAsync().WaitAsync(TimeSpan.FromSeconds(2));
        if (!received.Buffer.SequenceEqual(control))
        {
            throw new InvalidOperationException("udp-sentinel-control-failed");
        }
    }

    private static bool ListenerHasPendingConnection(TcpListener listener)
    {
        if (!listener.Server.IsBound)
        {
            throw new InvalidOperationException("tcp-sentinel-unbound");
        }
        return listener.Pending();
    }

    private static bool DeleteOwnedFixture(string ownedRoot)
    {
        try
        {
            if (!Directory.Exists(ownedRoot))
            {
                return !File.Exists(ownedRoot);
            }
            var pending = new Stack<string>();
            pending.Push(ownedRoot);
            while (pending.TryPop(out string? current))
            {
                if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0)
                {
                    return false;
                }
                foreach (string child in Directory.EnumerateDirectories(current, "*", SearchOption.TopDirectoryOnly))
                {
                    pending.Push(child);
                }
            }
            Directory.Delete(ownedRoot, recursive: true);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string FailureCode(Exception error) => error switch
    {
        SocketException socket => $"socket-{(int)socket.SocketErrorCode}",
        Win32Exception win32 => $"win32-{win32.NativeErrorCode}",
        UnauthorizedAccessException => "access-denied",
        IOException => "io-failure",
        JsonException => "probe-report-invalid",
        _ => error.GetType().Name switch
        {
            "InvalidOperationException" => "operation-invalid",
            "ArgumentException" => "argument-invalid",
            _ => "self-test-failed",
        },
    };
}

internal sealed record NativeRunResult(NativeSelfTestReport Report, int ExitCode);

using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.Text.Json;

namespace AiGamePlaybook.WindowsContainment;

internal static class SyntheticLaunchRunner
{
    internal static async Task<NativeSyntheticLaunchResult> RunAsync(
        NativeSyntheticLaunchRequest request)
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
        if (
            observedArtifactDigest != request.EntryArtifactDigest
            || artifactStream.Length != request.ExecutableArtifactBytes)
        {
            throw new ProtocolException("artifact-digest-mismatch");
        }

        string fixtureContent =
            $"agpb-synthetic-project-v1\n{request.ProjectRootIdentityDigest}\n{request.ChallengeDigest}\n";
        byte[] fixtureBytes = new UTF8Encoding(false, true).GetBytes(fixtureContent);
        if (
            request.ProjectFileCount != 1
            || fixtureBytes.Length != request.ProjectTotalBytes
            || Protocol.ComputeTextDigest(fixtureContent) != request.ProjectManifestDigest)
        {
            throw new ProtocolException("project-snapshot-mismatch");
        }
        string expectedOutputText = JsonSerializer.Serialize(
            ExpectedOutput(request),
            Protocol.JsonOptions);
        if (
            Encoding.UTF8.GetByteCount(expectedOutputText) > request.MaxOutputBytes
            || Protocol.ComputeTextDigest(expectedOutputText) != request.ExpectedOutputDigest)
        {
            throw new ProtocolException("expected-output-mismatch");
        }

        string compactId = request.LaunchId.Replace("-", string.Empty, StringComparison.Ordinal);
        string profileName = $"AiGamePlaybook.Launch.{compactId}";
        string ownedRoot = Path.Combine(Path.GetTempPath(), $"agpb-launch-{compactId}");
        string fixtureRoot = Path.Combine(ownedRoot, "fixture");
        string projectRoot = Path.Combine(fixtureRoot, "project");
        string sentinelPath = Path.Combine(projectRoot, "sentinel.txt");
        string workloadPath = Path.Combine(fixtureRoot, "workload.exe");

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
        bool terminationRequested = false;
        bool terminationConfirmed = true;
        bool observationUncertain = false;
        bool projectSnapshotPreserved = true;
        bool executableSnapshotPreserved = true;
        bool outputValid = false;
        bool outputTruncated = false;
        int outputCapturedBytes = 0;
        int outputObservedBytes = 0;
        string outputObservedDigest = Protocol.ComputeTextDigest(string.Empty);
        int? processExitCode = null;
        JobAccounting? accounting = null;
        string? outputPath = null;

        try
        {
            if (Directory.Exists(ownedRoot) || File.Exists(ownedRoot))
            {
                throw new InvalidOperationException("owned-root-collision");
            }
            fixtureCreated = true;
            Directory.CreateDirectory(projectRoot);
            await File.WriteAllBytesAsync(sentinelPath, fixtureBytes);
            await using (FileStream workload = new(
                workloadPath,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                128 * 1024,
                FileOptions.SequentialScan))
            {
                artifactStream.Position = 0;
                await artifactStream.CopyToAsync(workload);
                await workload.FlushAsync();
            }
            AssertFixtureSnapshots(
                request,
                projectRoot,
                sentinelPath,
                workloadPath,
                out projectSnapshotPreserved,
                out executableSnapshotPreserved);
            if (!projectSnapshotPreserved || !executableSnapshotPreserved)
            {
                throw new InvalidOperationException("fixture-snapshot-drift");
            }

            int profileResult = NativeMethods.CreateAppContainerProfile(
                profileName,
                profileName,
                "AI Game Playbook disposable contained launch",
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
            outputPath = Path.Combine(profileState, "synthetic-output.json");

            job = NativeMethods.CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "job-create-failed");
            }
            WindowsProcess.ConfigureJob(job);

            string[] command =
            {
                workloadPath,
                "synthetic-workload",
                "--project", projectRoot,
                "--report", outputPath,
                "--challenge-digest", request.ChallengeDigest,
                "--entry-artifact-digest", request.EntryArtifactDigest,
                "--executable-snapshot-digest", request.ExecutableSnapshotDigest,
                "--project-manifest-digest", request.ProjectManifestDigest,
                "--project-root-identity-digest", request.ProjectRootIdentityDigest,
                "--project-snapshot-digest", request.ProjectSnapshotDigest,
                "--expected-output-digest", request.ExpectedOutputDigest,
            };
            IReadOnlyDictionary<string, string> environment =
                WindowsProcess.BuildContainedEnvironment(profileRoot, profileTemp);
            (process, thread) = WindowsProcess.CreateContainedProcess(
                workloadPath,
                WindowsProcess.BuildCommandLine(command),
                projectRoot,
                WindowsProcess.BuildEnvironmentBlock(environment),
                appContainerSid);
            processStarted = true;
            terminationConfirmed = false;
            if (!NativeMethods.AssignProcessToJobObject(job, process))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "job-assignment-failed");
            }
            processAssignedToJob = true;
            if (NativeMethods.ResumeThread(thread) == uint.MaxValue)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "process-resume-failed");
            }

            int elapsedMs = checked((int)(DateTimeOffset.UtcNow - started).TotalMilliseconds);
            int remainingMs = Math.Min(
                request.MaxDurationMs - elapsedMs - request.TerminationGraceMs,
                checked((int)(request.ExpiresAt - DateTimeOffset.UtcNow).TotalMilliseconds)
                    - request.TerminationGraceMs);
            if (remainingMs < 1)
            {
                throw new TimeoutException("launch-window-exhausted");
            }
            uint wait = NativeMethods.WaitForSingleObject(process, (uint)remainingMs);
            if (wait == NativeMethods.WaitTimeout)
            {
                terminationRequested = true;
                if (!NativeMethods.TerminateJobObject(job, 124))
                {
                    observationUncertain = true;
                }
                wait = NativeMethods.WaitForSingleObject(
                    process,
                    (uint)request.TerminationGraceMs);
            }
            terminationConfirmed = wait == NativeMethods.WaitObject0;
            if (!terminationConfirmed)
            {
                observationUncertain = true;
            }
            else if (!NativeMethods.GetExitCodeProcess(process, out uint nativeExitCode))
            {
                observationUncertain = true;
            }
            else
            {
                processExitCode = unchecked((int)nativeExitCode);
            }
            accounting = WindowsProcess.QueryJobAccounting(job);
            if (outputPath is not null && File.Exists(outputPath))
            {
                (outputObservedDigest,
                 outputCapturedBytes,
                 outputObservedBytes,
                 outputTruncated,
                 outputValid) = ReadOutput(
                    outputPath,
                    expectedOutputText,
                    request.MaxOutputBytes);
            }
            AssertFixtureSnapshots(
                request,
                projectRoot,
                sentinelPath,
                workloadPath,
                out projectSnapshotPreserved,
                out executableSnapshotPreserved);
        }
        catch
        {
            if (processStarted)
            {
                observationUncertain = true;
            }
            outputValid = false;
        }
        finally
        {
            if (process != IntPtr.Zero)
            {
                uint wait = NativeMethods.WaitForSingleObject(process, 0);
                if (wait == NativeMethods.WaitTimeout)
                {
                    terminationRequested = true;
                    bool terminated = processAssignedToJob && job != IntPtr.Zero
                        ? NativeMethods.TerminateJobObject(job, 124)
                        : NativeMethods.TerminateProcess(process, 124);
                    terminationConfirmed = terminated
                        && NativeMethods.WaitForSingleObject(
                            process,
                            (uint)request.TerminationGraceMs) == NativeMethods.WaitObject0;
                    if (!terminationConfirmed)
                    {
                        observationUncertain = true;
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
                    observationUncertain = true;
                }
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
                profileRemoved = WindowsProcess.DeleteAppContainerProfile(profileName);
            }
            if (appContainerSid != IntPtr.Zero)
            {
                NativeMethods.FreeSid(appContainerSid);
            }
            if (fixtureCreated)
            {
                fixtureRemoved = WindowsProcess.DeleteOwnedFixture(ownedRoot);
            }
        }

        bool childProcessStarted = (accounting?.TotalProcesses ?? 0) > 1;
        bool activeProcessesClear = !processStarted
            || (accounting is not null && accounting.ActiveProcesses == 0);
        bool cleanupComplete =
            profileRemoved && fixtureRemoved && activeProcessesClear;
        if (processStarted && accounting is null)
        {
            observationUncertain = true;
        }
        if (!projectSnapshotPreserved || !executableSnapshotPreserved)
        {
            observationUncertain = true;
        }
        string cleanup = observationUncertain
            ? "uncertain"
            : cleanupComplete
                ? "complete"
                : "incomplete";
        bool succeeded =
            processStarted
            && processExitCode == 0
            && accounting?.TotalProcesses == 1
            && accounting.ActiveProcesses == 0
            && outputValid
            && !outputTruncated
            && projectSnapshotPreserved
            && executableSnapshotPreserved
            && !terminationRequested
            && terminationConfirmed
            && cleanup == "complete";
        string outcome = observationUncertain
            ? "uncertain"
            : succeeded
                ? "succeeded"
                : "failed";

        DateTimeOffset completed = Protocol.TruncateToMilliseconds(DateTimeOffset.UtcNow);
        if (completed <= started)
        {
            completed = started.AddMilliseconds(1);
        }
        int durationMs = checked((int)(completed - started).TotalMilliseconds);
        if (durationMs > request.MaxDurationMs || completed > request.ExpiresAt)
        {
            throw new ProtocolException("synthetic-launch-duration-exceeded");
        }
        var report = new NativeSyntheticLaunchReport(
            "1.0.0",
            "synthetic-launch",
            request.LaunchId,
            request.RequestDigest,
            observedArtifactDigest,
            request.ProjectSnapshotDigest,
            request.ExecutableSnapshotDigest,
            request.InvocationDigest,
            Protocol.FormatTimestamp(started),
            Protocol.FormatTimestamp(completed),
            durationMs,
            new NativeSyntheticLaunchProcess(
                processStarted,
                processExitCode,
                accounting?.TotalProcesses,
                accounting?.ActiveProcesses),
            new NativeSyntheticLaunchOutput(
                request.ExpectedOutputDigest,
                outputObservedDigest,
                outputCapturedBytes,
                outputObservedBytes,
                outputTruncated),
            new NativeSyntheticLaunchTermination(
                terminationRequested,
                terminationConfirmed),
            new NativeSyntheticLaunchEffects(
                projectSnapshotPreserved,
                executableSnapshotPreserved,
                !projectSnapshotPreserved,
                false,
                childProcessStarted,
                cleanup),
            outcome,
            observationUncertain);
        int exitCode = outcome switch
        {
            "succeeded" => 0,
            "failed" => 2,
            _ => 3,
        };
        return new NativeSyntheticLaunchResult(report, exitCode);
    }

    private static SyntheticWorkloadOutput ExpectedOutput(
        NativeSyntheticLaunchRequest request) =>
        new(
            request.ChallengeDigest,
            request.EntryArtifactDigest,
            request.ExecutableSnapshotDigest,
            request.ProjectManifestDigest,
            request.ProjectRootIdentityDigest,
            request.ProjectSnapshotDigest,
            "1.0.0",
            "succeeded");

    private static void AssertFixtureSnapshots(
        NativeSyntheticLaunchRequest request,
        string projectRoot,
        string sentinelPath,
        string workloadPath,
        out bool projectPreserved,
        out bool executablePreserved)
    {
        projectPreserved = false;
        executablePreserved = false;
        if (
            !Directory.Exists(projectRoot)
            || (File.GetAttributes(projectRoot) & FileAttributes.ReparsePoint) != 0)
        {
            return;
        }
        string[] entries = Directory.EnumerateFileSystemEntries(
            projectRoot,
            "*",
            SearchOption.TopDirectoryOnly).ToArray();
        projectPreserved =
            entries.Length == request.ProjectFileCount
            && entries.Length == 1
            && string.Equals(
                Path.GetFullPath(entries[0]),
                Path.GetFullPath(sentinelPath),
                StringComparison.OrdinalIgnoreCase)
            && (File.GetAttributes(sentinelPath) & FileAttributes.ReparsePoint) == 0
            && new FileInfo(sentinelPath).Length == request.ProjectTotalBytes
            && Protocol.ComputeFileDigest(sentinelPath) == request.ProjectManifestDigest;
        executablePreserved =
            File.Exists(workloadPath)
            && (File.GetAttributes(workloadPath) & FileAttributes.ReparsePoint) == 0
            && new FileInfo(workloadPath).Length == request.ExecutableArtifactBytes
            && Protocol.ComputeFileDigest(workloadPath) == request.EntryArtifactDigest;
    }

    private static (string Digest, int Captured, int Observed, bool Truncated, bool Valid)
        ReadOutput(string path, string expected, int maximumBytes)
    {
        if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
        {
            return (Protocol.ComputeTextDigest(string.Empty), 0, 0, false, false);
        }
        long length = new FileInfo(path).Length;
        if (length < 0)
        {
            return (Protocol.ComputeTextDigest(string.Empty), 0, 0, false, false);
        }
        if (length > maximumBytes)
        {
            return (
                Protocol.ComputeTextDigest(string.Empty),
                maximumBytes,
                maximumBytes + 1,
                true,
                false);
        }
        byte[] bytes = File.ReadAllBytes(path);
        string text;
        try
        {
            text = new UTF8Encoding(false, true).GetString(bytes);
        }
        catch (DecoderFallbackException)
        {
            return (Protocol.ComputeTextDigest(string.Empty), bytes.Length, bytes.Length, false, false);
        }
        string digest = Protocol.ComputeTextDigest(text);
        return (
            digest,
            bytes.Length,
            bytes.Length,
            false,
            string.Equals(text, expected, StringComparison.Ordinal));
    }
}

internal sealed record NativeSyntheticLaunchResult(
    NativeSyntheticLaunchReport Report,
    int ExitCode);

using System.ComponentModel;
using System.Diagnostics;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Runtime.InteropServices;
using System.Text;

namespace AiGamePlaybook.WindowsContainment;

internal static class EngineRunRunner
{
    private static readonly HashSet<string> ExcludedTopLevelEntries = new(
        new[] { ".agents", ".ai-game-playbook", ".git", ".godot", ".worktrees" },
        StringComparer.OrdinalIgnoreCase);

    internal static async Task<NativeEngineRunResult> RunAsync(NativeEngineRunRequest request)
    {
        DateTimeOffset started = Protocol.TruncateToMilliseconds(DateTimeOffset.UtcNow);
        string providerExecutable = Environment.ProcessPath
            ?? throw new ProtocolException("artifact-path-unavailable");
        if (Protocol.ComputeFileDigest(providerExecutable) != request.EntryArtifactDigest)
        {
            throw new ProtocolException("artifact-digest-mismatch");
        }

        string compactId = request.RunId.Replace("-", string.Empty, StringComparison.Ordinal);
        string profileName = $"AiGamePlaybook.Engine.{compactId}";
        string ownedRoot = Path.Combine(Path.GetTempPath(), $"agpb-engine-{compactId}");
        string stagedExecutableDirectory = Path.Combine(ownedRoot, "engine");
        string stagedExecutable = Path.Combine(stagedExecutableDirectory, "godot.exe");

        IntPtr appContainerSid = IntPtr.Zero;
        IntPtr job = IntPtr.Zero;
        IntPtr process = IntPtr.Zero;
        IntPtr thread = IntPtr.Zero;
        EventWaitHandle? cancellationEvent = null;
        bool profileCreated = false;
        bool profileRemoved = true;
        bool ownedRootCreated = false;
        bool ownedRootRemoved = true;
        bool processStarted = false;
        DateTimeOffset? processStartedAt = null;
        bool processAssignedToJob = false;
        bool terminationRequested = false;
        bool terminationConfirmed = true;
        string terminationCause = "none";
        bool observationUncertain = false;
        bool sourceProjectPreserved = false;
        bool sourceExecutablePreserved = false;
        bool stagedProjectBaselinePreserved = false;
        bool stagedExecutableBaselinePreserved = false;
        bool profileBudgetPreserved = true;
        int? processExitCode = null;
        JobAccounting? accounting = null;
        string? profileRoot = null;
        string? stagedProject = null;
        string? logPath = null;
        NativeEngineRunOutput output = EmptyOutput();
        byte[]? transcriptBytes = null;

        try
        {
            cancellationEvent = EngineRunCancellationControl.Create(
                request.RunId,
                request.RequestDigest,
                request.CancellationId);
            if (Directory.Exists(ownedRoot) || File.Exists(ownedRoot))
            {
                throw new InvalidOperationException("owned-root-collision");
            }
            sourceProjectPreserved = ProjectMatches(request, request.SourceProjectRoot);
            sourceExecutablePreserved = ExecutableMatches(
                request.SourceExecutablePath,
                request.SourceExecutableDigest,
                request.SourceExecutableBytes);
            if (!sourceProjectPreserved || !sourceExecutablePreserved)
            {
                throw new InvalidOperationException("source-snapshot-drift");
            }
            ThrowIfCancellationRequested(cancellationEvent);

            int profileResult = NativeMethods.CreateAppContainerProfile(
                profileName,
                profileName,
                "AI Game Playbook disposable engine run",
                IntPtr.Zero,
                0,
                out appContainerSid);
            if (profileResult != 0)
            {
                Marshal.ThrowExceptionForHR(profileResult);
            }
            profileCreated = true;
            profileRemoved = false;
            var sid = new SecurityIdentifier(appContainerSid);
            profileRoot = WindowsProcess.GetProfileRoot(sid.Value);
            string profileState = Path.Combine(profileRoot, "LocalState");
            string profileTemp = Path.Combine(profileRoot, "TempState");
            stagedProject = Path.Combine(profileState, "project");
            logPath = Path.Combine(profileState, "logs", "godot.log");
            Directory.CreateDirectory(stagedProject);
            Directory.CreateDirectory(Path.GetDirectoryName(logPath)!);
            Directory.CreateDirectory(profileTemp);

            ownedRootCreated = true;
            ownedRootRemoved = false;
            Directory.CreateDirectory(stagedExecutableDirectory);
            await CopyExpectedFileAsync(
                request.SourceExecutablePath,
                stagedExecutable,
                request.SourceExecutableDigest,
                request.SourceExecutableBytes,
                cancellationEvent);
            WindowsProcess.GrantReadExecute(ownedRoot, sid);
            await CopyProjectAsync(request, stagedProject, cancellationEvent);

            stagedProjectBaselinePreserved = ProjectMatches(request, stagedProject);
            stagedExecutableBaselinePreserved = ExecutableMatches(
                stagedExecutable,
                request.SourceExecutableDigest,
                request.SourceExecutableBytes);
            sourceProjectPreserved = ProjectMatches(request, request.SourceProjectRoot);
            sourceExecutablePreserved = ExecutableMatches(
                request.SourceExecutablePath,
                request.SourceExecutableDigest,
                request.SourceExecutableBytes);
            profileBudgetPreserved = ProfileWithinBudget(profileRoot, request.MaxProfileBytes);
            if (
                !stagedProjectBaselinePreserved
                || !stagedExecutableBaselinePreserved
                || !sourceProjectPreserved
                || !sourceExecutablePreserved
                || !profileBudgetPreserved)
            {
                throw new InvalidOperationException("staging-verification-failed");
            }
            ThrowIfCancellationRequested(cancellationEvent);
            if (DateTimeOffset.UtcNow >= request.StartDeadline)
            {
                throw new TimeoutException("start-window-exhausted");
            }

            job = NativeMethods.CreateJobObject(IntPtr.Zero, null);
            if (job == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "job-create-failed");
            }
            WindowsProcess.ConfigureJob(job);
            string[] command = BuildEngineCommand(request, stagedExecutable, stagedProject, logPath);
            IReadOnlyDictionary<string, string> environment =
                WindowsProcess.BuildContainedEnvironment(profileRoot, profileTemp);
            (process, thread) = WindowsProcess.CreateContainedProcess(
                stagedExecutable,
                WindowsProcess.BuildCommandLine(command),
                stagedProject,
                WindowsProcess.BuildEnvironmentBlock(environment),
                appContainerSid);
            processStarted = true;
            processStartedAt = Protocol.TruncateToMilliseconds(DateTimeOffset.UtcNow);
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

            EngineWaitResult engineWait = WaitForEngine(
                request,
                process,
                cancellationEvent,
                logPath);
            uint wait = engineWait.ProcessExited
                ? NativeMethods.WaitObject0
                : NativeMethods.WaitTimeout;
            if (engineWait.Uncertain)
            {
                observationUncertain = true;
            }
            else if (engineWait.Cause == "caller-cancelled")
            {
                terminationCause = "caller-cancelled";
                terminationRequested = true;
                if (!NativeMethods.TerminateJobObject(job, 125))
                {
                    observationUncertain = true;
                }
                wait = NativeMethods.WaitForSingleObject(
                    process,
                    (uint)request.TerminationGraceMs);
            }
            else if (engineWait.Cause is "engine-timeout" or "idle-timeout")
            {
                terminationCause = engineWait.Cause;
                terminationRequested = true;
                uint timeoutExitCode = terminationCause == "idle-timeout" ? 123u : 124u;
                if (!NativeMethods.TerminateJobObject(job, timeoutExitCode))
                {
                    observationUncertain = true;
                }
                wait = NativeMethods.WaitForSingleObject(
                    process,
                    (uint)request.TerminationGraceMs);
            }
            else if (!engineWait.ProcessExited)
            {
                observationUncertain = true;
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
            CapturedEngineLog capturedLog = ReadBoundedLog(logPath, request);
            output = capturedLog.Output;
            transcriptBytes = capturedLog.TranscriptBytes;
            stagedProjectBaselinePreserved = ProjectMatches(request, stagedProject);
            stagedExecutableBaselinePreserved = ExecutableMatches(
                stagedExecutable,
                request.SourceExecutableDigest,
                request.SourceExecutableBytes);
            sourceProjectPreserved = ProjectMatches(request, request.SourceProjectRoot);
            sourceExecutablePreserved = ExecutableMatches(
                request.SourceExecutablePath,
                request.SourceExecutableDigest,
                request.SourceExecutableBytes);
            profileBudgetPreserved = ProfileWithinBudget(profileRoot, request.MaxProfileBytes);
        }
        catch (OperationCanceledException)
        {
            terminationCause = "caller-cancelled";
        }
        catch
        {
            if (processStarted)
            {
                observationUncertain = true;
            }
        }
        finally
        {
            if (process != IntPtr.Zero)
            {
                uint wait = NativeMethods.WaitForSingleObject(process, 0);
                if (wait == NativeMethods.WaitTimeout)
                {
                    if (terminationCause == "none")
                    {
                        terminationCause = cancellationEvent?.WaitOne(0) == true
                            ? "caller-cancelled"
                            : "safety-boundary";
                    }
                    terminationRequested = true;
                    uint terminationExitCode = terminationCause == "caller-cancelled"
                        ? 125u
                        : terminationCause == "idle-timeout"
                            ? 123u
                            : 124u;
                    bool terminated = processAssignedToJob && job != IntPtr.Zero
                        ? NativeMethods.TerminateJobObject(job, terminationExitCode)
                        : NativeMethods.TerminateProcess(process, terminationExitCode);
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
            try
            {
                sourceProjectPreserved = ProjectMatches(request, request.SourceProjectRoot);
                sourceExecutablePreserved = ExecutableMatches(
                    request.SourceExecutablePath,
                    request.SourceExecutableDigest,
                    request.SourceExecutableBytes);
            }
            catch
            {
                sourceProjectPreserved = false;
                sourceExecutablePreserved = false;
                observationUncertain = true;
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
                profileRemoved = NativeMethods.DeleteAppContainerProfile(profileName) == 0;
            }
            if (appContainerSid != IntPtr.Zero)
            {
                NativeMethods.FreeSid(appContainerSid);
            }
            if (ownedRootCreated)
            {
                ownedRootRemoved = WindowsProcess.DeleteOwnedFixture(ownedRoot);
            }
            cancellationEvent?.Dispose();
        }

        bool childProcessStarted = (accounting?.TotalProcesses ?? 0) > request.MaxProcesses;
        bool activeProcessesClear = !processStarted
            || (accounting is not null && accounting.ActiveProcesses == 0);
        bool cleanupComplete = profileRemoved && ownedRootRemoved && activeProcessesClear;
        if (processStarted && accounting is null)
        {
            observationUncertain = true;
        }
        if (
            !sourceProjectPreserved
            || !sourceExecutablePreserved
            || childProcessStarted
            || !cleanupComplete)
        {
            observationUncertain = true;
        }
        string cleanup = observationUncertain && !cleanupComplete
            ? "uncertain"
            : cleanupComplete
                ? "complete"
                : "incomplete";
        bool succeeded =
            processStarted
            && processStartedAt is not null
            && processExitCode == 0
            && accounting?.TotalProcesses == 1
            && accounting.ActiveProcesses == 0
            && !output.Truncated
            && (request.OutputKind != "prefixed-json-lines"
                || transcriptBytes is not null)
            && !terminationRequested
            && terminationCause == "none"
            && terminationConfirmed
            && sourceProjectPreserved
            && sourceExecutablePreserved
            && stagedProjectBaselinePreserved
            && stagedExecutableBaselinePreserved
            && profileBudgetPreserved
            && !childProcessStarted
            && cleanup == "complete";
        bool cancelled =
            terminationCause == "caller-cancelled"
            && terminationConfirmed
            && sourceProjectPreserved
            && sourceExecutablePreserved
            && profileBudgetPreserved
            && !childProcessStarted
            && !output.Truncated
            && cleanup == "complete"
            && (!processStarted
                || (processExitCode is not null
                    && accounting is not null
                    && accounting.TotalProcesses == request.MaxProcesses
                    && accounting.ActiveProcesses == 0
                    && stagedProjectBaselinePreserved
                    && stagedExecutableBaselinePreserved));
        string outcome = observationUncertain
            ? "uncertain"
            : cancelled
                ? "cancelled"
                : succeeded
                    ? "succeeded"
                    : "failed";

        DateTimeOffset completed = Protocol.TruncateToMilliseconds(DateTimeOffset.UtcNow);
        if (completed < started)
        {
            completed = started;
        }
        int durationMs = checked((int)(completed - started).TotalMilliseconds);
        var report = new NativeEngineRunReport(
            "1.0.0",
            "godot-engine-run",
            request.RunId,
            request.RequestDigest,
            request.EntryArtifactDigest,
            request.AdmissionDigest,
            request.ProviderDescriptorDigest,
            request.ProviderCatalogDigest,
            request.OperationId,
            request.ProfileDigest,
            request.ProfileContractDigest,
            request.ProfileCatalogDigest,
            request.InvocationDigest,
            request.InputBindingDigest,
            request.SnapshotBindingDigest,
            request.ProjectSnapshotDigest,
            request.ExecutableSnapshotDigest,
            Protocol.FormatTimestamp(started),
            Protocol.FormatTimestamp(completed),
            durationMs,
            new NativeEngineRunProcess(
                processStarted,
                processStartedAt is null ? null : Protocol.FormatTimestamp(processStartedAt.Value),
                processExitCode,
                processStarted ? accounting?.TotalProcesses : 0,
                processStarted ? accounting?.ActiveProcesses : 0),
            output,
            new NativeEngineRunTermination(
                terminationRequested,
                terminationConfirmed,
                terminationCause),
            new NativeEngineRunEffects(
                sourceProjectPreserved,
                sourceExecutablePreserved,
                stagedProjectBaselinePreserved,
                stagedExecutableBaselinePreserved,
                profileBudgetPreserved,
                false,
                childProcessStarted,
                cleanup),
            outcome,
            observationUncertain);
        int exitCode = outcome switch
        {
            "succeeded" => 0,
            "failed" => 2,
            "cancelled" => 4,
            _ => 3,
        };
        bool cleanStructuredOutput =
            request.OutputKind == "prefixed-json-lines"
            && terminationCause == "none"
            && terminationConfirmed
            && !output.Truncated
            && processExitCode is 0 or 2
            && sourceProjectPreserved
            && sourceExecutablePreserved
            && stagedProjectBaselinePreserved
            && stagedExecutableBaselinePreserved
            && profileBudgetPreserved
            && !childProcessStarted
            && cleanup == "complete"
            && !observationUncertain;
        return new NativeEngineRunResult(
            report,
            exitCode,
            cleanStructuredOutput ? transcriptBytes : null);
    }

    private static string[] BuildEngineCommand(
        NativeEngineRunRequest request,
        string executable,
        string project,
        string logPath)
    {
        if (request.OperationId == EngineRunProtocol.PreflightOperationId)
        {
            return new[]
            {
                executable,
                "--headless",
                "--path",
                project,
                "--quit-after",
                "1",
                "--log-file",
                logPath,
                "--no-header",
            };
        }
        if (request.OperationId == EngineRunProtocol.ReplayOperationId)
        {
            return new[]
            {
                executable,
                "--headless",
                "--path",
                project,
                "--log-file",
                logPath,
                "--no-header",
                "--",
                "--agpb-replay",
            };
        }
        if (request.OperationId == EngineRunProtocol.ProjectImportOperationId)
        {
            return new[]
            {
                executable,
                "--headless",
                "--path",
                project,
                "--import",
                "--log-file",
                logPath,
                "--no-header",
            };
        }
        if (request.OperationId == EngineRunProtocol.ProjectValidationOperationId)
        {
            return new[]
            {
                executable,
                "--headless",
                "--path",
                project,
                "--script",
                EngineRunProtocol.ProjectValidationScript,
                "--log-file",
                logPath,
                "--no-header",
            };
        }
        throw new ProtocolException("request-value-invalid");
    }

    private static EngineWaitResult WaitForEngine(
        NativeEngineRunRequest request,
        IntPtr process,
        EventWaitHandle cancellationEvent,
        string logPath)
    {
        var elapsed = Stopwatch.StartNew();
        long lastActivityMs = 0;
        EngineLogActivity priorActivity = ObserveLogActivity(logPath);
        bool enforceIdle = request.OutputKind == "prefixed-json-lines";
        IntPtr[] handles =
        {
            process,
            cancellationEvent.SafeWaitHandle.DangerousGetHandle(),
        };

        while (true)
        {
            long elapsedMs = elapsed.ElapsedMilliseconds;
            if (elapsedMs >= request.ProcessTimeoutMs)
            {
                return new EngineWaitResult(false, "engine-timeout", false);
            }
            if (enforceIdle && elapsedMs - lastActivityMs >= request.IdleTimeoutMs)
            {
                return new EngineWaitResult(false, "idle-timeout", false);
            }

            long remaining = request.ProcessTimeoutMs - elapsedMs;
            if (enforceIdle)
            {
                remaining = Math.Min(
                    remaining,
                    request.IdleTimeoutMs - (elapsedMs - lastActivityMs));
            }
            uint waitMs = checked((uint)Math.Max(1, Math.Min(100, remaining)));
            uint wait = NativeMethods.WaitForMultipleObjects(
                2,
                handles,
                false,
                waitMs);
            if (wait == NativeMethods.WaitObject0)
            {
                return new EngineWaitResult(true, "none", false);
            }
            if (wait == NativeMethods.WaitObject0 + 1)
            {
                return new EngineWaitResult(false, "caller-cancelled", false);
            }
            if (wait != NativeMethods.WaitTimeout)
            {
                return new EngineWaitResult(false, "safety-boundary", true);
            }

            EngineLogActivity currentActivity = ObserveLogActivity(logPath);
            if (currentActivity != priorActivity)
            {
                priorActivity = currentActivity;
                lastActivityMs = elapsed.ElapsedMilliseconds;
            }
        }
    }

    private static EngineLogActivity ObserveLogActivity(string path)
    {
        try
        {
            if (!File.Exists(path) || HasReparsePoint(path))
            {
                return new EngineLogActivity(false, 0, 0);
            }
            var info = new FileInfo(path);
            return new EngineLogActivity(true, info.Length, info.LastWriteTimeUtc.Ticks);
        }
        catch
        {
            return new EngineLogActivity(false, 0, 0);
        }
    }

    private static async Task CopyProjectAsync(
        NativeEngineRunRequest request,
        string destinationRoot,
        EventWaitHandle cancellationEvent)
    {
        foreach (string directory in request.ProjectDirectories.Skip(1))
        {
            ThrowIfCancellationRequested(cancellationEvent);
            Directory.CreateDirectory(ResolveRelative(destinationRoot, directory));
        }
        foreach (NativeEngineRunFile file in request.ProjectFiles)
        {
            ThrowIfCancellationRequested(cancellationEvent);
            string source = ResolveRelative(request.SourceProjectRoot, file.Path);
            string destination = ResolveRelative(destinationRoot, file.Path);
            await CopyExpectedFileAsync(
                source,
                destination,
                file.Digest,
                file.Bytes,
                cancellationEvent);
        }
    }

    private static async Task CopyExpectedFileAsync(
        string source,
        string destination,
        string expectedDigest,
        int expectedBytes,
        EventWaitHandle cancellationEvent)
    {
        if (!RegularFileMatches(source, expectedDigest, expectedBytes))
        {
            throw new InvalidOperationException("source-file-drift");
        }
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        await using (FileStream input = new(
            source,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            128 * 1024,
            FileOptions.SequentialScan))
        await using (FileStream output = new(
            destination,
            FileMode.CreateNew,
            FileAccess.Write,
            FileShare.None,
            128 * 1024,
            FileOptions.SequentialScan))
        {
            byte[] buffer = new byte[128 * 1024];
            while (true)
            {
                ThrowIfCancellationRequested(cancellationEvent);
                int bytesRead = await input.ReadAsync(buffer);
                if (bytesRead == 0)
                {
                    break;
                }
                await output.WriteAsync(buffer.AsMemory(0, bytesRead));
            }
            await output.FlushAsync();
        }
        if (
            !RegularFileMatches(source, expectedDigest, expectedBytes)
            || !RegularFileMatches(destination, expectedDigest, expectedBytes))
        {
            throw new InvalidOperationException("copied-file-drift");
        }
    }

    private static void ThrowIfCancellationRequested(
        EventWaitHandle cancellationEvent)
    {
        if (cancellationEvent.WaitOne(0))
        {
            throw new OperationCanceledException("caller-cancelled");
        }
    }

    private static bool ProjectMatches(NativeEngineRunRequest request, string root)
    {
        try
        {
            CapturedProject captured = CaptureProject(root, request);
            return captured.TotalBytes == request.ProjectTotalBytes
                && captured.Directories.SequenceEqual(request.ProjectDirectories, StringComparer.Ordinal)
                && captured.Files.Count == request.ProjectFiles.Count
                && captured.Files.Zip(request.ProjectFiles).All(pair => pair.First == pair.Second);
        }
        catch
        {
            return false;
        }
    }

    private static CapturedProject CaptureProject(
        string root,
        NativeEngineRunRequest request)
    {
        if (!Directory.Exists(root) || HasReparsePoint(root))
        {
            throw new InvalidOperationException("project-root-invalid");
        }
        var directories = new List<string> { string.Empty };
        var files = new List<NativeEngineRunFile>();
        var portablePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var pending = new Stack<(string Absolute, string Relative)>();
        pending.Push((root, string.Empty));
        long totalBytes = 0;
        while (pending.TryPop(out (string Absolute, string Relative) current))
        {
            string[] entries = Directory.EnumerateFileSystemEntries(
                current.Absolute,
                "*",
                SearchOption.TopDirectoryOnly).ToArray();
            Array.Sort(entries, StringComparer.Ordinal);
            foreach (string entry in entries)
            {
                string name = Path.GetFileName(entry);
                if (current.Relative.Length == 0 && ExcludedTopLevelEntries.Contains(name))
                {
                    continue;
                }
                string relative = current.Relative.Length == 0
                    ? name
                    : $"{current.Relative}/{name}";
                if (!portablePaths.Add(relative) || HasReparsePoint(entry))
                {
                    throw new InvalidOperationException("project-entry-invalid");
                }
                FileAttributes attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.Directory) != 0)
                {
                    if (directories.Count >= request.MaxProjectDirectories)
                    {
                        throw new InvalidOperationException("project-directory-budget-exceeded");
                    }
                    directories.Add(relative);
                    pending.Push((entry, relative));
                    continue;
                }
                if (files.Count >= request.MaxProjectFiles)
                {
                    throw new InvalidOperationException("project-file-budget-exceeded");
                }
                var info = new FileInfo(entry);
                if (info.Length is < 0 or > EngineRunProtocol.MaximumProjectFileBytes)
                {
                    throw new InvalidOperationException("project-file-budget-exceeded");
                }
                int bytes = checked((int)info.Length);
                totalBytes += bytes;
                if (totalBytes > request.MaxProjectBytes)
                {
                    throw new InvalidOperationException("project-byte-budget-exceeded");
                }
                files.Add(new NativeEngineRunFile(relative, Protocol.ComputeFileDigest(entry), bytes));
            }
        }
        directories.Sort(StringComparer.Ordinal);
        files.Sort((left, right) => StringComparer.Ordinal.Compare(left.Path, right.Path));
        return new CapturedProject(directories.AsReadOnly(), files.AsReadOnly(), checked((int)totalBytes));
    }

    private static bool ExecutableMatches(string path, string digest, int bytes)
    {
        try
        {
            return RegularFileMatches(path, digest, bytes);
        }
        catch
        {
            return false;
        }
    }

    private static bool RegularFileMatches(string path, string digest, int bytes)
    {
        if (!File.Exists(path) || HasReparsePoint(path))
        {
            return false;
        }
        var info = new FileInfo(path);
        return info.Length == bytes && Protocol.ComputeFileDigest(path) == digest;
    }

    private static bool ProfileWithinBudget(string root, int maximumBytes)
    {
        try
        {
            long total = 0;
            var pending = new Stack<string>();
            pending.Push(root);
            while (pending.TryPop(out string? current))
            {
                if (HasReparsePoint(current))
                {
                    return false;
                }
                foreach (string directory in Directory.EnumerateDirectories(
                             current,
                             "*",
                             SearchOption.TopDirectoryOnly))
                {
                    pending.Push(directory);
                }
                foreach (string file in Directory.EnumerateFiles(
                             current,
                             "*",
                             SearchOption.TopDirectoryOnly))
                {
                    if (HasReparsePoint(file))
                    {
                        return false;
                    }
                    total += new FileInfo(file).Length;
                    if (total > maximumBytes)
                    {
                        return false;
                    }
                }
            }
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static CapturedEngineLog ReadBoundedLog(
        string path,
        NativeEngineRunRequest request)
    {
        try
        {
            if (!File.Exists(path))
            {
                return new CapturedEngineLog(EmptyOutput(), null);
            }
            if (HasReparsePoint(path))
            {
                return new CapturedEngineLog(
                    new NativeEngineRunOutput(EmptyDigest(), 0, 1, true),
                    null);
            }
            long length = new FileInfo(path).Length;
            int observed = checked((int)Math.Min(length, request.MaxProfileBytes));
            int captured = Math.Min(observed, request.MaxOutputBytes);
            byte[] bytes = new byte[captured];
            using FileStream stream = new(
                path,
                FileMode.Open,
                FileAccess.Read,
                FileShare.Read,
                64 * 1024,
                FileOptions.SequentialScan);
            int offset = 0;
            while (offset < captured)
            {
                int read = stream.Read(bytes, offset, captured - offset);
                if (read == 0)
                {
                    break;
                }
                offset += read;
            }
            if (offset != captured)
            {
                return new CapturedEngineLog(
                    new NativeEngineRunOutput(EmptyDigest(), 0, 1, true),
                    null);
            }
            string digest = $"sha256:{Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()}";
            bool truncated = observed > captured;
            if (
                request.OutputKind == "prefixed-json-lines"
                && !truncated
                && !PrefixedJsonLinesOutputWithinBounds(bytes, request))
            {
                if (observed == 0)
                {
                    return new CapturedEngineLog(
                        new NativeEngineRunOutput(digest, 0, 0, false),
                        null);
                }
                return new CapturedEngineLog(
                    new NativeEngineRunOutput(
                        EmptyDigest(),
                        0,
                        observed,
                        true),
                    null);
            }
            var output = new NativeEngineRunOutput(digest, captured, observed, truncated);
            return new CapturedEngineLog(
                output,
                request.OutputKind == "prefixed-json-lines" && !truncated
                    ? bytes
                    : null);
        }
        catch
        {
            return new CapturedEngineLog(
                new NativeEngineRunOutput(EmptyDigest(), 0, 1, true),
                null);
        }
    }

    private static bool PrefixedJsonLinesOutputWithinBounds(
        byte[] bytes,
        NativeEngineRunRequest request)
    {
        if (
            bytes.Length == 0
            || bytes[^1] != (byte)'\n'
            || request.OutputPrefix is null
            || request.MaxLineBytes is null
            || request.MaxEvents is null)
        {
            return false;
        }
        byte[] prefix = Encoding.UTF8.GetBytes(request.OutputPrefix);
        int start = 0;
        int events = 0;
        for (int index = 0; index < bytes.Length; index += 1)
        {
            if (bytes[index] != (byte)'\n')
            {
                continue;
            }
            int end = index > start && bytes[index - 1] == (byte)'\r'
                ? index - 1
                : index;
            int lineBytes = end - start;
            events += 1;
            if (
                lineBytes < prefix.Length
                || lineBytes > request.MaxLineBytes.Value
                || events > request.MaxEvents.Value
                || !bytes.AsSpan(start, prefix.Length).SequenceEqual(prefix))
            {
                return false;
            }
            start = index + 1;
        }
        return start == bytes.Length && events > 0;
    }

    private static NativeEngineRunOutput EmptyOutput() =>
        new(EmptyDigest(), 0, 0, false);

    private static string EmptyDigest() =>
        $"sha256:{Convert.ToHexString(SHA256.HashData(Array.Empty<byte>())).ToLowerInvariant()}";

    private static bool HasReparsePoint(string path) =>
        (File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0;

    private static string ResolveRelative(string root, string relative)
    {
        string value = Path.GetFullPath(
            Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        string normalizedRoot = Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        if (!value.StartsWith(normalizedRoot, StringComparison.OrdinalIgnoreCase))
        {
            throw new InvalidOperationException("relative-path-escaped");
        }
        return value;
    }
}

internal sealed record CapturedProject(
    IReadOnlyList<string> Directories,
    IReadOnlyList<NativeEngineRunFile> Files,
    int TotalBytes);

internal readonly record struct EngineWaitResult(
    bool ProcessExited,
    string Cause,
    bool Uncertain);

internal readonly record struct EngineLogActivity(
    bool Exists,
    long Length,
    long LastWriteTicks);

internal sealed record CapturedEngineLog(
    NativeEngineRunOutput Output,
    byte[]? TranscriptBytes);

internal sealed record NativeEngineRunProcess(
    bool Started,
    string? StartedAt,
    int? ExitCode,
    uint? TotalProcesses,
    uint? ActiveProcesses);

internal sealed record NativeEngineRunOutput(
    string LogDigest,
    int CapturedBytes,
    int ObservedBytes,
    bool Truncated);

internal sealed record NativeEngineRunTermination(
    bool Requested,
    bool Confirmed,
    string Cause);

internal sealed record NativeEngineRunEffects(
    bool SourceProjectPreserved,
    bool SourceExecutablePreserved,
    bool StagedProjectBaselinePreserved,
    bool StagedExecutableBaselinePreserved,
    bool ProfileBudgetPreserved,
    bool NetworkConnectionEstablished,
    bool ChildProcessStarted,
    string Cleanup);

internal sealed record NativeEngineRunReport(
    string SchemaVersion,
    string Operation,
    string RunId,
    string RequestDigest,
    string EntryArtifactDigest,
    string AdmissionDigest,
    string ProviderDescriptorDigest,
    string ProviderCatalogDigest,
    string OperationId,
    string ProfileDigest,
    string ProfileContractDigest,
    string ProfileCatalogDigest,
    string InvocationDigest,
    string? InputBindingDigest,
    string SnapshotBindingDigest,
    string ProjectSnapshotDigest,
    string ExecutableSnapshotDigest,
    string StartedAt,
    string CompletedAt,
    int DurationMs,
    NativeEngineRunProcess Process,
    NativeEngineRunOutput Output,
    NativeEngineRunTermination Termination,
    NativeEngineRunEffects Effects,
    string Outcome,
    bool MutationUncertain);

internal sealed record NativeEngineRunResult(
    NativeEngineRunReport Report,
    int ExitCode,
    byte[]? TranscriptBytes);

internal sealed record NativeEngineStructuredOutputEnvelope(
    string SchemaVersion,
    string Operation,
    NativeEngineRunReport Report,
    string? StructuredOutputBase64);

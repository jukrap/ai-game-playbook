using System.ComponentModel;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Runtime.InteropServices;

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
        bool profileCreated = false;
        bool profileRemoved = true;
        bool ownedRootCreated = false;
        bool ownedRootRemoved = true;
        bool processStarted = false;
        DateTimeOffset? processStartedAt = null;
        bool processAssignedToJob = false;
        bool terminationRequested = false;
        bool terminationConfirmed = true;
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

        try
        {
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
                request.SourceExecutableBytes);
            WindowsProcess.GrantReadExecute(ownedRoot, sid);
            await CopyProjectAsync(request, stagedProject);

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
            string[] command =
            {
                stagedExecutable,
                "--headless",
                "--path",
                stagedProject,
                "--quit-after",
                "1",
                "--log-file",
                logPath,
                "--no-header",
            };
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

            uint wait = NativeMethods.WaitForSingleObject(process, (uint)request.EngineTimeoutMs);
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
            output = ReadBoundedLog(logPath, request.MaxOutputBytes, request.MaxProfileBytes);
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
            && !terminationRequested
            && terminationConfirmed
            && sourceProjectPreserved
            && sourceExecutablePreserved
            && stagedProjectBaselinePreserved
            && stagedExecutableBaselinePreserved
            && profileBudgetPreserved
            && !childProcessStarted
            && cleanup == "complete";
        string outcome = observationUncertain
            ? "uncertain"
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
            request.ProfileDigest,
            request.InvocationDigest,
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
            new NativeEngineRunTermination(terminationRequested, terminationConfirmed),
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
            _ => 3,
        };
        return new NativeEngineRunResult(report, exitCode);
    }

    private static async Task CopyProjectAsync(
        NativeEngineRunRequest request,
        string destinationRoot)
    {
        foreach (string directory in request.ProjectDirectories.Skip(1))
        {
            Directory.CreateDirectory(ResolveRelative(destinationRoot, directory));
        }
        foreach (NativeEngineRunFile file in request.ProjectFiles)
        {
            string source = ResolveRelative(request.SourceProjectRoot, file.Path);
            string destination = ResolveRelative(destinationRoot, file.Path);
            await CopyExpectedFileAsync(source, destination, file.Digest, file.Bytes);
        }
    }

    private static async Task CopyExpectedFileAsync(
        string source,
        string destination,
        string expectedDigest,
        int expectedBytes)
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
            await input.CopyToAsync(output);
            await output.FlushAsync();
        }
        if (
            !RegularFileMatches(source, expectedDigest, expectedBytes)
            || !RegularFileMatches(destination, expectedDigest, expectedBytes))
        {
            throw new InvalidOperationException("copied-file-drift");
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

    private static NativeEngineRunOutput ReadBoundedLog(
        string path,
        int maximumOutputBytes,
        int maximumObservedBytes)
    {
        try
        {
            if (!File.Exists(path))
            {
                return EmptyOutput();
            }
            if (HasReparsePoint(path))
            {
                return new NativeEngineRunOutput(EmptyDigest(), 0, 1, true);
            }
            long length = new FileInfo(path).Length;
            int observed = checked((int)Math.Min(length, maximumObservedBytes));
            int captured = Math.Min(observed, maximumOutputBytes);
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
                return new NativeEngineRunOutput(EmptyDigest(), 0, 1, true);
            }
            string digest = $"sha256:{Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()}";
            return new NativeEngineRunOutput(digest, captured, observed, observed > captured);
        }
        catch
        {
            return new NativeEngineRunOutput(EmptyDigest(), 0, 1, true);
        }
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

internal sealed record NativeEngineRunTermination(bool Requested, bool Confirmed);

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
    string ProfileDigest,
    string InvocationDigest,
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

internal sealed record NativeEngineRunResult(NativeEngineRunReport Report, int ExitCode);

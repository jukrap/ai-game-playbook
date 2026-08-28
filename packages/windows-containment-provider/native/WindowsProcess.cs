using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Text;

namespace AiGamePlaybook.WindowsContainment;

internal static class WindowsProcess
{
    internal static bool IsCurrentProcessAppContainer()
    {
        if (!NativeMethods.OpenProcessToken(
                NativeMethods.GetCurrentProcess(),
                NativeMethods.TokenQuery,
                out IntPtr token))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "process-token-open-failed");
        }
        IntPtr value = IntPtr.Zero;
        try
        {
            value = Marshal.AllocHGlobal(sizeof(int));
            Marshal.WriteInt32(value, 0);
            if (!NativeMethods.GetTokenInformation(
                    token,
                    NativeMethods.TokenIsAppContainer,
                    value,
                    sizeof(int),
                    out uint returned)
                || returned != sizeof(int))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "appcontainer-token-query-failed");
            }
            return Marshal.ReadInt32(value) != 0;
        }
        finally
        {
            if (value != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(value);
            }
            NativeMethods.CloseHandle(token);
        }
    }

    internal static string GetCurrentAppContainerProfileRoot()
    {
        if (!NativeMethods.OpenProcessToken(
                NativeMethods.GetCurrentProcess(),
                NativeMethods.TokenQuery,
                out IntPtr token))
        {
            throw new Win32Exception(Marshal.GetLastWin32Error(), "process-token-open-failed");
        }
        IntPtr value = IntPtr.Zero;
        try
        {
            NativeMethods.GetTokenInformation(
                token,
                NativeMethods.TokenAppContainerSid,
                IntPtr.Zero,
                0,
                out uint required);
            if (required < IntPtr.Size || required > 64 * 1024)
            {
                throw new InvalidOperationException("appcontainer-sid-size-invalid");
            }
            value = Marshal.AllocHGlobal(checked((int)required));
            if (!NativeMethods.GetTokenInformation(
                    token,
                    NativeMethods.TokenAppContainerSid,
                    value,
                    required,
                    out uint returned)
                || returned != required)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "appcontainer-sid-query-failed");
            }
            IntPtr sidPointer = Marshal.ReadIntPtr(value);
            if (sidPointer == IntPtr.Zero)
            {
                throw new InvalidOperationException("appcontainer-sid-unavailable");
            }
            var sid = new SecurityIdentifier(sidPointer);
            return GetProfileRoot(sid.Value);
        }
        finally
        {
            if (value != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(value);
            }
            NativeMethods.CloseHandle(token);
        }
    }

    internal static (IntPtr Process, IntPtr Thread) CreateContainedProcess(
        string application,
        string commandLine,
        string currentDirectory,
        byte[] environment,
        IntPtr appContainerSid)
    {
        IntPtr attributeList = IntPtr.Zero;
        IntPtr securityCapabilities = IntPtr.Zero;
        IntPtr childPolicy = IntPtr.Zero;
        IntPtr environmentPointer = IntPtr.Zero;
        IntPtr attributeSize = IntPtr.Zero;
        try
        {
            NativeMethods.InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref attributeSize);
            if (attributeSize == IntPtr.Zero)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "attribute-list-size-failed");
            }
            attributeList = Marshal.AllocHGlobal(attributeSize);
            if (!NativeMethods.InitializeProcThreadAttributeList(attributeList, 2, 0, ref attributeSize))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "attribute-list-create-failed");
            }

            NativeMethods.SECURITY_CAPABILITIES capabilities = new()
            {
                AppContainerSid = appContainerSid,
                Capabilities = IntPtr.Zero,
                CapabilityCount = 0,
                Reserved = 0,
            };
            securityCapabilities = Marshal.AllocHGlobal(Marshal.SizeOf<NativeMethods.SECURITY_CAPABILITIES>());
            Marshal.StructureToPtr(capabilities, securityCapabilities, false);
            if (!NativeMethods.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    NativeMethods.ProcThreadAttributeSecurityCapabilities,
                    securityCapabilities,
                    (UIntPtr)(uint)Marshal.SizeOf<NativeMethods.SECURITY_CAPABILITIES>(),
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "security-capabilities-failed");
            }

            childPolicy = Marshal.AllocHGlobal(sizeof(uint));
            Marshal.WriteInt32(childPolicy, unchecked((int)NativeMethods.ProcessCreationChildProcessRestricted));
            if (!NativeMethods.UpdateProcThreadAttribute(
                    attributeList,
                    0,
                    NativeMethods.ProcThreadAttributeChildProcessPolicy,
                    childPolicy,
                    (UIntPtr)sizeof(uint),
                    IntPtr.Zero,
                    IntPtr.Zero))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "child-policy-failed");
            }

            environmentPointer = Marshal.AllocHGlobal(environment.Length);
            Marshal.Copy(environment, 0, environmentPointer, environment.Length);
            NativeMethods.STARTUPINFOEX startup = new()
            {
                StartupInfo = new NativeMethods.STARTUPINFO
                {
                    cb = Marshal.SizeOf<NativeMethods.STARTUPINFOEX>(),
                },
                lpAttributeList = attributeList,
            };
            var mutableCommand = new StringBuilder(commandLine);
            bool created = NativeMethods.CreateProcessExtended(
                application,
                mutableCommand,
                IntPtr.Zero,
                IntPtr.Zero,
                false,
                NativeMethods.CreateSuspended
                    | NativeMethods.CreateUnicodeEnvironment
                    | NativeMethods.ExtendedStartupInfoPresent,
                environmentPointer,
                currentDirectory,
                ref startup,
                out NativeMethods.PROCESS_INFORMATION info);
            if (!created)
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "contained-process-create-failed");
            }
            return (info.hProcess, info.hThread);
        }
        finally
        {
            if (attributeList != IntPtr.Zero)
            {
                NativeMethods.DeleteProcThreadAttributeList(attributeList);
                Marshal.FreeHGlobal(attributeList);
            }
            if (securityCapabilities != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(securityCapabilities);
            }
            if (childPolicy != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(childPolicy);
            }
            if (environmentPointer != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(environmentPointer);
            }
        }
    }

    internal static void ConfigureJob(IntPtr job)
    {
        NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits = new();
        limits.BasicLimitInformation.LimitFlags =
            NativeMethods.JobObjectLimitActiveProcess
            | NativeMethods.JobObjectLimitKillOnJobClose;
        limits.BasicLimitInformation.ActiveProcessLimit = 1;
        int size = Marshal.SizeOf<NativeMethods.JOBOBJECT_EXTENDED_LIMIT_INFORMATION>();
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            Marshal.StructureToPtr(limits, buffer, false);
            if (!NativeMethods.SetInformationJobObject(
                    job,
                    NativeMethods.JobObjectExtendedLimitInformation,
                    buffer,
                    (uint)size))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "job-policy-failed");
            }
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    internal static JobAccounting QueryJobAccounting(IntPtr job)
    {
        int size = Marshal.SizeOf<NativeMethods.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>();
        IntPtr buffer = Marshal.AllocHGlobal(size);
        try
        {
            if (!NativeMethods.QueryInformationJobObject(
                    job,
                    NativeMethods.JobObjectBasicAccountingInformation,
                    buffer,
                    (uint)size,
                    out _))
            {
                throw new Win32Exception(Marshal.GetLastWin32Error(), "job-accounting-failed");
            }
            NativeMethods.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION value =
                Marshal.PtrToStructure<NativeMethods.JOBOBJECT_BASIC_ACCOUNTING_INFORMATION>(buffer);
            return new JobAccounting(
                value.TotalProcesses,
                value.ActiveProcesses,
                value.TotalTerminatedProcesses);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    internal static void GrantReadExecute(string path, SecurityIdentifier sid)
    {
        FileSystemRights rights = FileSystemRights.ReadAndExecute
            | FileSystemRights.Read
            | FileSystemRights.ListDirectory
            | FileSystemRights.Synchronize;
        foreach (string directoryPath in Directory
                     .EnumerateDirectories(path, "*", SearchOption.AllDirectories)
                     .Prepend(path))
        {
            var directory = new DirectoryInfo(directoryPath);
            DirectorySecurity security = directory.GetAccessControl(AccessControlSections.Access);
            security.AddAccessRule(new FileSystemAccessRule(
                sid,
                rights,
                InheritanceFlags.ContainerInherit | InheritanceFlags.ObjectInherit,
                PropagationFlags.None,
                AccessControlType.Allow));
            directory.SetAccessControl(security);
        }
        foreach (string filePath in Directory.EnumerateFiles(path, "*", SearchOption.AllDirectories))
        {
            var file = new FileInfo(filePath);
            FileSecurity security = file.GetAccessControl(AccessControlSections.Access);
            security.AddAccessRule(new FileSystemAccessRule(sid, rights, AccessControlType.Allow));
            file.SetAccessControl(security);
        }
    }

    internal static string GetProfileRoot(string sid)
    {
        int result = NativeMethods.GetAppContainerFolderPath(sid, out IntPtr pointer);
        if (result != 0)
        {
            Marshal.ThrowExceptionForHR(result);
        }
        try
        {
            return Marshal.PtrToStringUni(pointer)
                ?? throw new InvalidOperationException("profile-path-empty");
        }
        finally
        {
            Marshal.FreeCoTaskMem(pointer);
        }
    }

    internal static byte[] BuildEnvironmentBlock(IReadOnlyDictionary<string, string> environment)
    {
        string block = string.Join('\0', environment
            .OrderBy(item => item.Key, StringComparer.OrdinalIgnoreCase)
            .Select(item => $"{item.Key}={item.Value}")) + "\0\0";
        return Encoding.Unicode.GetBytes(block);
    }

    internal static IReadOnlyDictionary<string, string> BuildContainedEnvironment(
        string profileRoot,
        string profileTemp)
    {
        string roamingState = Path.Combine(profileRoot, "RoamingState");
        Directory.CreateDirectory(roamingState);
        string systemRoot = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
        if (string.IsNullOrEmpty(systemRoot) || !Path.IsPathFullyQualified(systemRoot) || systemRoot.StartsWith(@"\\", StringComparison.Ordinal))
        {
            throw new InvalidOperationException("windows-directory-invalid");
        }
        string systemDrive = Path.GetPathRoot(systemRoot) ?? @"C:\";
        string commonApplicationData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ALLUSERSPROFILE"] = commonApplicationData,
            ["APPDATA"] = roamingState,
            ["ComSpec"] = Path.Combine(systemRoot, "System32", "cmd.exe"),
            ["HOMEDRIVE"] = systemDrive.TrimEnd('\\'),
            ["HOMEPATH"] = profileRoot[systemDrive.Length..],
            ["LOCALAPPDATA"] = profileRoot,
            ["NUMBER_OF_PROCESSORS"] = Environment.ProcessorCount.ToString(System.Globalization.CultureInfo.InvariantCulture),
            ["OS"] = "Windows_NT",
            ["Path"] = Path.Combine(systemRoot, "System32"),
            ["PATHEXT"] = ".COM;.EXE;.BAT;.CMD",
            ["PROCESSOR_ARCHITECTURE"] = "AMD64",
            ["ProgramData"] = commonApplicationData,
            ["ProgramFiles"] = programFiles,
            ["SystemDrive"] = systemDrive.TrimEnd('\\'),
            ["SystemRoot"] = systemRoot,
            ["TEMP"] = profileTemp,
            ["TMP"] = profileTemp,
            ["USERNAME"] = "sandbox",
            ["USERPROFILE"] = profileRoot,
            ["WINDIR"] = systemRoot,
            ["DOTNET_BUNDLE_EXTRACT_BASE_DIR"] = profileTemp,
        };
        string? programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        if (!string.IsNullOrEmpty(programFilesX86))
        {
            result["ProgramFiles(x86)"] = programFilesX86;
        }
        return result;
    }

    internal static string BuildCommandLine(IEnumerable<string> arguments) =>
        string.Join(' ', arguments.Select(QuoteWindowsArgument));

    internal static bool DeleteOwnedFixture(string ownedRoot)
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
                foreach (string child in Directory.EnumerateDirectories(
                             current,
                             "*",
                             SearchOption.TopDirectoryOnly))
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

    private static string QuoteWindowsArgument(string value)
    {
        if (value.Length > 0 && value.All(character => !char.IsWhiteSpace(character) && character != '"'))
        {
            return value;
        }
        var result = new StringBuilder("\"");
        int backslashes = 0;
        foreach (char character in value)
        {
            if (character == '\\')
            {
                backslashes += 1;
                continue;
            }
            if (character == '"')
            {
                result.Append('\\', backslashes * 2 + 1);
                result.Append('"');
                backslashes = 0;
                continue;
            }
            result.Append('\\', backslashes);
            result.Append(character);
            backslashes = 0;
        }
        result.Append('\\', backslashes * 2);
        result.Append('"');
        return result.ToString();
    }
}

internal sealed record JobAccounting(
    uint TotalProcesses,
    uint ActiveProcesses,
    uint TotalTerminatedProcesses);

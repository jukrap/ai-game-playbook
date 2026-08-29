using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace AiGamePlaybook.GodotFixture;

internal static class Program
{
    private const uint TokenQuery = 0x0008;
    private const int TokenIsAppContainer = 29;

    internal static async Task<int> Main(string[] args)
    {
        if (args.Length == 1 && args[0] == "--version")
        {
            Console.WriteLine("4.7.2.stable.official.fixture");
            return 0;
        }
        if (!OperatingSystem.IsWindows() || !IsAppContainer())
        {
            return 70;
        }
        if (args.Length == 1 && args[0] == "--child")
        {
            return 0;
        }
        if (
            args.Length != 8
            || args[0] != "--headless"
            || args[1] != "--path"
            || args[3] != "--quit-after"
            || args[4] != "1"
            || args[5] != "--log-file"
            || args[7] != "--no-header")
        {
            return 64;
        }
        string project = args[2];
        string log = args[6];
        if (
            !Path.IsPathFullyQualified(project)
            || !Path.IsPathFullyQualified(log)
            || !File.Exists(Path.Combine(project, "project.godot")))
        {
            return 65;
        }
        string behaviorPath = Path.Combine(project, "fixture-behavior.txt");
        string behavior = File.Exists(behaviorPath)
            ? (await File.ReadAllTextAsync(behaviorPath)).Trim()
            : "success";
        Directory.CreateDirectory(Path.GetDirectoryName(log)!);
        switch (behavior)
        {
            case "success":
                await File.WriteAllTextAsync(log, "fixture-success\n", new UTF8Encoding(false));
                return 0;
            case "fail":
                await File.WriteAllTextAsync(log, "fixture-failure\n", new UTF8Encoding(false));
                return 7;
            case "hang":
                await File.WriteAllTextAsync(log, "fixture-hang\n", new UTF8Encoding(false));
                await Task.Delay(TimeSpan.FromSeconds(30));
                return 0;
            case "mutate-staged":
                await File.AppendAllTextAsync(
                    Path.Combine(project, "project.godot"),
                    "changed=true\n",
                    new UTF8Encoding(false));
                await File.WriteAllTextAsync(log, "fixture-mutated\n", new UTF8Encoding(false));
                return 0;
            case "overflow-log":
                await File.WriteAllBytesAsync(log, Enumerable.Repeat((byte)0x61, 300 * 1024).ToArray());
                return 0;
            case "profile-overflow":
                string overflow = Path.Combine(Path.GetDirectoryName(project)!, "profile-overflow.bin");
                await using (FileStream stream = new(
                    overflow,
                    FileMode.CreateNew,
                    FileAccess.Write,
                    FileShare.None))
                {
                    stream.SetLength(65L * 1024 * 1024);
                    await stream.FlushAsync();
                }
                await File.WriteAllTextAsync(log, "fixture-profile-overflow\n", new UTF8Encoding(false));
                return 0;
            case "spawn-child":
                try
                {
                    using Process? child = Process.Start(new ProcessStartInfo
                    {
                        FileName = Environment.ProcessPath!,
                        Arguments = "--child",
                        UseShellExecute = false,
                        CreateNoWindow = true,
                    });
                    if (child is not null)
                    {
                        await child.WaitForExitAsync();
                    }
                }
                catch
                {
                    // A denied child is the expected contained outcome.
                }
                await File.WriteAllTextAsync(log, "fixture-child-probe\n", new UTF8Encoding(false));
                return 0;
            default:
                return 66;
        }
    }

    private static bool IsAppContainer()
    {
        if (!OpenProcessToken(GetCurrentProcess(), TokenQuery, out IntPtr token))
        {
            return false;
        }
        try
        {
            int size = sizeof(int);
            IntPtr buffer = Marshal.AllocHGlobal(size);
            try
            {
                return GetTokenInformation(
                        token,
                        TokenIsAppContainer,
                        buffer,
                        (uint)size,
                        out _)
                    && Marshal.ReadInt32(buffer) != 0;
            }
            finally
            {
                Marshal.FreeHGlobal(buffer);
            }
        }
        finally
        {
            CloseHandle(token);
        }
    }

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetCurrentProcess();

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool OpenProcessToken(
        IntPtr process,
        uint desiredAccess,
        out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool GetTokenInformation(
        IntPtr token,
        int informationClass,
        IntPtr information,
        uint informationLength,
        out uint returnLength);

    [DllImport("kernel32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseHandle(IntPtr handle);
}

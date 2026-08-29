using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

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
        bool preflight =
            args.Length == 8
            && args[0] == "--headless"
            && args[1] == "--path"
            && args[3] == "--quit-after"
            && args[4] == "1"
            && args[5] == "--log-file"
            && args[7] == "--no-header";
        bool replay =
            args.Length == 8
            && args[0] == "--headless"
            && args[1] == "--path"
            && args[3] == "--log-file"
            && args[5] == "--no-header"
            && args[6] == "--"
            && args[7] == "--agpb-replay";
        if (!preflight && !replay)
        {
            return 64;
        }
        string project = args[2];
        string log = preflight ? args[6] : args[4];
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
            : replay ? "replay-success" : "success";
        Directory.CreateDirectory(Path.GetDirectoryName(log)!);
        if (replay)
        {
            string replayPath = Path.Combine(project, "fixture-replay.txt");
            string transcript = File.Exists(replayPath)
                ? await File.ReadAllTextAsync(replayPath)
                : await BuildReplayTranscriptAsync(project);
            switch (behavior)
            {
                case "replay-success":
                    await File.WriteAllTextAsync(log, transcript, new UTF8Encoding(false));
                    return 0;
                case "replay-fail":
                    await File.WriteAllTextAsync(log, transcript, new UTF8Encoding(false));
                    return 2;
                case "replay-mutate-staged":
                    await File.AppendAllTextAsync(
                        Path.Combine(project, "project.godot"),
                        "changed=true\n",
                        new UTF8Encoding(false));
                    await File.WriteAllTextAsync(log, transcript, new UTF8Encoding(false));
                    return 0;
                case "replay-idle":
                    await File.WriteAllTextAsync(
                        log,
                        "AGPB_GRAYBOX {\"event\":\"replay-started\"}\n",
                        new UTF8Encoding(false));
                    await Task.Delay(TimeSpan.FromSeconds(30));
                    return 0;
                case "replay-activity":
                    await File.WriteAllTextAsync(
                        log,
                        "AGPB_GRAYBOX {\"event\":\"heartbeat-0\"}\n",
                        new UTF8Encoding(false));
                    await Task.Delay(TimeSpan.FromSeconds(8));
                    await File.AppendAllTextAsync(
                        log,
                        "AGPB_GRAYBOX {\"event\":\"heartbeat-1\"}\n",
                        new UTF8Encoding(false));
                    await Task.Delay(TimeSpan.FromSeconds(8));
                    await File.AppendAllTextAsync(
                        log,
                        "AGPB_GRAYBOX {\"event\":\"heartbeat-2\"}\n",
                        new UTF8Encoding(false));
                    return 0;
                case "replay-line-overflow":
                    await File.WriteAllTextAsync(
                        log,
                        $"AGPB_GRAYBOX {new string('x', 66 * 1024)}\n",
                        new UTF8Encoding(false));
                    return 0;
                case "replay-event-overflow":
                    await File.WriteAllTextAsync(
                        log,
                        string.Concat(
                            Enumerable.Range(0, 2_051).Select(
                                index => $"AGPB_GRAYBOX {{\"event\":\"event-{index}\"}}\n")),
                        new UTF8Encoding(false));
                    return 0;
                default:
                    return 66;
            }
        }
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

    private static async Task<string> BuildReplayTranscriptAsync(string project)
    {
        string scenarioPath = Path.Combine(project, "scenario.json");
        string manifestPath = Path.Combine(project, "manifest.json");
        if (!File.Exists(scenarioPath) || !File.Exists(manifestPath))
        {
            return string.Empty;
        }

        using JsonDocument scenario = JsonDocument.Parse(
            await File.ReadAllTextAsync(scenarioPath));
        using JsonDocument manifest = JsonDocument.Parse(
            await File.ReadAllTextAsync(manifestPath));
        JsonElement root = scenario.RootElement;
        string scenarioId = root.GetProperty("scenarioId").GetString()!;
        string scenarioDigest = manifest.RootElement
            .GetProperty("scenario")
            .GetProperty("digest")
            .GetString()!;
        string seed = root
            .GetProperty("initialState")
            .GetProperty("seed")
            .GetString()!;
        StringBuilder transcript = new();
        AppendEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "replay-started",
            ["scenarioId"] = scenarioId,
            ["scenarioDigest"] = scenarioDigest,
            ["seed"] = seed,
        });

        int terminalTick = 0;
        foreach ((JsonElement oracle, bool terminal) in ReplayOracles(root))
        {
            int tick = OracleTick(oracle);
            terminalTick = terminal ? Math.Max(terminalTick, tick) : terminalTick;
            List<Dictionary<string, object?>> state = [];
            int value = 0;
            foreach (JsonElement path in oracle.GetProperty("stateHashFields").EnumerateArray())
            {
                state.Add(new Dictionary<string, object?>
                {
                    ["path"] = path.GetString()!,
                    ["value"] = value,
                });
                value += 1;
            }
            string stateJson = JsonSerializer.Serialize(state);
            string stateHash = "sha256:" + Convert.ToHexString(
                SHA256.HashData(Encoding.UTF8.GetBytes(stateJson))).ToLowerInvariant();
            AppendEvent(transcript, new Dictionary<string, object?>
            {
                ["event"] = "oracle-passed",
                ["oracleId"] = oracle.GetProperty("oracleId").GetString()!,
                ["terminal"] = terminal,
                ["tick"] = tick,
                ["state"] = state,
                ["stateHash"] = stateHash,
            });
        }
        AppendEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "replay-passed",
            ["tick"] = terminalTick,
            ["scenarioDigest"] = scenarioDigest,
        });
        return transcript.ToString();
    }

    private static IEnumerable<(JsonElement Oracle, bool Terminal)> ReplayOracles(
        JsonElement scenario)
    {
        foreach (JsonElement oracle in scenario.GetProperty("checkpoints").EnumerateArray())
        {
            yield return (oracle, false);
        }
        foreach (JsonElement oracle in scenario.GetProperty("terminal").EnumerateArray())
        {
            yield return (oracle, true);
        }
    }

    private static int OracleTick(JsonElement oracle)
    {
        return oracle.TryGetProperty("atTick", out JsonElement atTick)
            ? atTick.GetInt32()
            : oracle.GetProperty("withinTicks").GetProperty("firstTick").GetInt32();
    }

    private static void AppendEvent(
        StringBuilder transcript,
        Dictionary<string, object?> value)
    {
        transcript.Append("AGPB_GRAYBOX ");
        transcript.Append(JsonSerializer.Serialize(value));
        transcript.Append('\n');
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

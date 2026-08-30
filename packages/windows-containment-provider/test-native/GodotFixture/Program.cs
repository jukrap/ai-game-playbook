using System.Buffers.Binary;
using System.Diagnostics;
using System.IO.Compression;
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
        bool projectImport =
            args.Length == 7
            && args[0] == "--headless"
            && args[1] == "--path"
            && args[3] == "--import"
            && args[4] == "--log-file"
            && args[6] == "--no-header";
        bool projectValidation =
            args.Length == 8
            && args[0] == "--headless"
            && args[1] == "--path"
            && args[3] == "--script"
            && args[4] == "res://addons/ai_game_playbook/validators/project_validation.gd"
            && args[5] == "--log-file"
            && args[7] == "--no-header";
        bool persistenceSave =
            args.Length == 8
            && args[0] == "--headless"
            && args[1] == "--path"
            && args[3] == "--log-file"
            && args[5] == "--no-header"
            && args[6] == "--"
            && args[7] == "--agpb-persistence-save";
        bool persistenceLoad =
            args.Length == 8
            && args[0] == "--headless"
            && args[1] == "--path"
            && args[3] == "--log-file"
            && args[5] == "--no-header"
            && args[6] == "--"
            && args[7] == "--agpb-persistence-load";
        bool persistence = persistenceSave || persistenceLoad;
        bool runtimeFrameCapture =
            args.Length == 13
            && args[0] == "--path"
            && args[2] == "--log-file"
            && args[4] == "--no-header"
            && args[5] == "--"
            && args[6] == "--agpb-runtime-frame"
            && args[7] == "--agpb-run-id"
            && Guid.TryParseExact(args[8], "D", out _)
            && args[9] == "--agpb-input-binding"
            && args[10].StartsWith("sha256:", StringComparison.Ordinal)
            && args[11] == "--agpb-artifact";
        if (
            !preflight
            && !replay
            && !projectImport
            && !projectValidation
            && !persistence
            && !runtimeFrameCapture)
        {
            return 64;
        }
        string project = runtimeFrameCapture ? args[1] : args[2];
        string log = preflight ? args[6]
            : replay ? args[4]
            : projectImport ? args[5]
            : persistence ? args[4]
            : runtimeFrameCapture ? args[3]
            : args[6];
        if (
            !Path.IsPathFullyQualified(project)
            || !Path.IsPathFullyQualified(log)
            || !File.Exists(Path.Combine(project, "project.godot"))
            || (runtimeFrameCapture && !Path.IsPathFullyQualified(args[12]))
            || (projectValidation
                && !File.Exists(Path.Combine(
                    project,
                    "addons",
                    "ai_game_playbook",
                    "validators",
                    "project_validation.gd"))))
        {
            return 65;
        }
        string behaviorPath = Path.Combine(project, "fixture-behavior.txt");
        string behavior = File.Exists(behaviorPath)
            ? (await File.ReadAllTextAsync(behaviorPath)).Trim()
            : replay ? "replay-success"
            : projectImport ? "project-import-success"
            : projectValidation ? "project-validation-success"
            : persistence ? "persistence-success"
            : runtimeFrameCapture && args[8].EndsWith("f", StringComparison.Ordinal)
                ? "capture-fail"
            : runtimeFrameCapture ? "capture-success"
            : "success";
        Directory.CreateDirectory(Path.GetDirectoryName(log)!);
        if (runtimeFrameCapture)
        {
            string artifact = args[12];
            bool detailedRuntimeFrame =
                File.Exists(Path.Combine(project, "scenario.json"))
                && File.Exists(Path.Combine(project, "manifest.json"));
            byte[] png = detailedRuntimeFrame
                ? BuildRuntimeFramePng()
                : Convert.FromBase64String(
                    "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAC0lEQVR4nGOohwIAEeUD+Ueg6nYAAAAASUVORK5CYII=");
            string transcript = detailedRuntimeFrame
                ? await BuildRuntimeFrameTranscriptAsync(
                    project,
                    args[8],
                    args[10],
                    png,
                    false)
                : "AGPB_RUNTIME_FRAME {\"event\":\"fixture-frame-captured\"}\n";
            switch (behavior)
            {
                case "capture-success":
                    await File.WriteAllBytesAsync(artifact, png);
                    await File.WriteAllTextAsync(log, transcript, new UTF8Encoding(false));
                    return 0;
                case "capture-missing":
                    await File.WriteAllTextAsync(log, transcript, new UTF8Encoding(false));
                    return 0;
                case "capture-oversize":
                    byte[] oversized = new byte[4 * 1024 * 1024 + 1];
                    png.AsSpan(0, 8).CopyTo(oversized);
                    await File.WriteAllBytesAsync(artifact, oversized);
                    await File.WriteAllTextAsync(log, transcript, new UTF8Encoding(false));
                    return 0;
                case "capture-fail":
                    await File.WriteAllTextAsync(
                        log,
                        detailedRuntimeFrame
                            ? await BuildRuntimeFrameTranscriptAsync(
                                project,
                                args[8],
                                args[10],
                                png,
                                true)
                            : transcript,
                        new UTF8Encoding(false));
                    return 2;
                case "capture-mutate-staged":
                    await File.AppendAllTextAsync(
                        Path.Combine(project, "project.godot"),
                        "changed=true\n",
                        new UTF8Encoding(false));
                    await File.WriteAllBytesAsync(artifact, png);
                    await File.WriteAllTextAsync(log, transcript, new UTF8Encoding(false));
                    return 0;
                case "capture-line-overflow":
                    await File.WriteAllBytesAsync(artifact, png);
                    await File.WriteAllTextAsync(
                        log,
                        $"AGPB_RUNTIME_FRAME {new string('x', 66 * 1024)}\n",
                        new UTF8Encoding(false));
                    return 0;
                default:
                    return 66;
            }
        }
        if (persistence)
        {
            string appData = Environment.GetEnvironmentVariable("APPDATA") ?? string.Empty;
            if (!Path.IsPathFullyQualified(appData))
            {
                return 65;
            }
            string savePath = Path.Combine(
                appData,
                "Godot",
                "app_userdata",
                "AI Game Playbook Graybox",
                "graybox-save.json");
            switch (behavior)
            {
                case "persistence-success":
                    if (persistenceSave)
                    {
                        byte[] saveBytes = Encoding.UTF8.GetBytes(
                            "{\"schemaVersion\":\"1.0.0\",\"position\":[-2,1,-6],\"score\":2,\"collected\":[\"first\",\"second\"],\"won\":true}\n");
                        Directory.CreateDirectory(Path.GetDirectoryName(savePath)!);
                        await File.WriteAllBytesAsync(savePath, saveBytes);
                        await File.WriteAllTextAsync(
                            log,
                            await BuildPersistenceTranscriptAsync(
                                project,
                                "save",
                                saveBytes),
                            new UTF8Encoding(false));
                        return 0;
                    }
                    if (!File.Exists(savePath))
                    {
                        return 67;
                    }
                    byte[] loadedBytes = await File.ReadAllBytesAsync(savePath);
                    await File.WriteAllTextAsync(
                        log,
                        await BuildPersistenceTranscriptAsync(
                            project,
                            "load",
                            loadedBytes),
                        new UTF8Encoding(false));
                    return 0;
                case "persistence-save-fail":
                    if (!persistenceSave)
                    {
                        return 68;
                    }
                    await File.WriteAllTextAsync(
                        log,
                        await BuildPersistenceStartOnlyAsync(project, "save", null),
                        new UTF8Encoding(false));
                    return 2;
                case "persistence-load-fail":
                    if (persistenceSave)
                    {
                        byte[] saveBytes = Encoding.UTF8.GetBytes("fixture-save\n");
                        Directory.CreateDirectory(Path.GetDirectoryName(savePath)!);
                        await File.WriteAllBytesAsync(savePath, saveBytes);
                        await File.WriteAllTextAsync(
                            log,
                            await BuildPersistenceTranscriptAsync(
                                project,
                                "save",
                                saveBytes),
                            new UTF8Encoding(false));
                        return 0;
                    }
                    byte[] failedLoadBytes = await File.ReadAllBytesAsync(savePath);
                    await File.WriteAllTextAsync(
                        log,
                        await BuildPersistenceStartOnlyAsync(
                            project,
                            "load",
                            failedLoadBytes),
                        new UTF8Encoding(false));
                    return 2;
                case "persistence-load-idle":
                    if (persistenceSave)
                    {
                        byte[] saveBytes = Encoding.UTF8.GetBytes("fixture-save\n");
                        Directory.CreateDirectory(Path.GetDirectoryName(savePath)!);
                        await File.WriteAllBytesAsync(savePath, saveBytes);
                        await File.WriteAllTextAsync(
                            log,
                            await BuildPersistenceTranscriptAsync(
                                project,
                                "save",
                                saveBytes),
                            new UTF8Encoding(false));
                        return 0;
                    }
                    byte[] idleBytes = await File.ReadAllBytesAsync(savePath);
                    await File.WriteAllTextAsync(
                        log,
                        await BuildPersistenceStartOnlyAsync(
                            project,
                            "load",
                            idleBytes),
                        new UTF8Encoding(false));
                    await Task.Delay(TimeSpan.FromSeconds(30));
                    return 0;
                case "persistence-mutate-staged":
                    if (persistenceSave)
                    {
                        await File.AppendAllTextAsync(
                            Path.Combine(project, "project.godot"),
                            "changed=true\n",
                            new UTF8Encoding(false));
                    }
                    return 2;
                case "persistence-line-overflow":
                    await File.WriteAllTextAsync(
                        log,
                        $"AGPB_PERSISTENCE {new string('x', 17 * 1024)}\n",
                        new UTF8Encoding(false));
                    return 0;
                default:
                    return 66;
            }
        }
        if (projectImport)
        {
            switch (behavior)
            {
                case "project-import-success":
                    string cache = Path.Combine(project, ".godot", "imported");
                    Directory.CreateDirectory(cache);
                    await File.WriteAllTextAsync(
                        Path.Combine(cache, "fixture.cache"),
                        "bounded-import-cache\n",
                        new UTF8Encoding(false));
                    await File.WriteAllTextAsync(
                        log,
                        "fixture-project-import-success\n",
                        new UTF8Encoding(false));
                    return 0;
                case "project-import-fail":
                    await File.WriteAllTextAsync(
                        log,
                        "fixture-project-import-failure\n",
                        new UTF8Encoding(false));
                    return 7;
                case "project-import-mutate-staged":
                    await File.AppendAllTextAsync(
                        Path.Combine(project, "project.godot"),
                        "changed=true\n",
                        new UTF8Encoding(false));
                    await File.WriteAllTextAsync(
                        log,
                        "fixture-project-import-mutated\n",
                        new UTF8Encoding(false));
                    return 0;
                default:
                    return 66;
            }
        }
        if (projectValidation)
        {
            string validationPath = Path.Combine(project, "fixture-validation.txt");
            string validationOutput = File.Exists(validationPath)
                ? await File.ReadAllTextAsync(validationPath)
                : await BuildProjectValidationTranscriptAsync(project);
            switch (behavior)
            {
                case "project-validation-success":
                    await File.WriteAllTextAsync(
                        log,
                        validationOutput,
                        new UTF8Encoding(false));
                    return 0;
                case "project-validation-fail":
                    await File.WriteAllTextAsync(
                        log,
                        validationOutput,
                        new UTF8Encoding(false));
                    return 2;
                case "project-validation-mutate-staged":
                    await File.AppendAllTextAsync(
                        Path.Combine(project, "project.godot"),
                        "changed=true\n",
                        new UTF8Encoding(false));
                    await File.WriteAllTextAsync(
                        log,
                        validationOutput,
                        new UTF8Encoding(false));
                    return 0;
                case "project-validation-idle":
                    await File.WriteAllTextAsync(
                        log,
                        "AGPB_PROJECT_VALIDATION {\"event\":\"validation-started\"}\n",
                        new UTF8Encoding(false));
                    await Task.Delay(TimeSpan.FromSeconds(30));
                    return 0;
                case "project-validation-line-overflow":
                    await File.WriteAllTextAsync(
                        log,
                        $"AGPB_PROJECT_VALIDATION {new string('x', 17 * 1024)}\n",
                        new UTF8Encoding(false));
                    return 0;
                case "project-validation-event-overflow":
                    await File.WriteAllTextAsync(
                        log,
                        string.Concat(
                            Enumerable.Range(0, 3).Select(
                                index => $"AGPB_PROJECT_VALIDATION {{\"event\":\"event-{index}\"}}\n")),
                        new UTF8Encoding(false));
                    return 0;
                default:
                    return 66;
            }
        }
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
            return "AGPB_RUNTIME_FRAME {\"event\":\"fixture-frame-captured\"}\n";
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

    private static async Task<string> BuildRuntimeFrameTranscriptAsync(
        string project,
        string runId,
        string inputBindingDigest,
        byte[] png,
        bool captureFailed)
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
        AppendRuntimeFrameEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "capture-started",
            ["runId"] = runId,
            ["scenarioId"] = scenarioId,
            ["scenarioDigest"] = scenarioDigest,
            ["seed"] = seed,
            ["inputBindingDigest"] = inputBindingDigest,
            ["sceneId"] = "scene.graybox.main",
            ["cameraId"] = "camera.follow",
        });
        int terminalTick = 0;
        string terminalStateHash = string.Empty;
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
            if (terminal)
            {
                terminalStateHash = stateHash;
            }
            AppendRuntimeFrameEvent(transcript, new Dictionary<string, object?>
            {
                ["event"] = "oracle-passed",
                ["oracleId"] = oracle.GetProperty("oracleId").GetString()!,
                ["terminal"] = terminal,
                ["tick"] = tick,
                ["state"] = state,
                ["stateHash"] = stateHash,
            });
        }
        AppendRuntimeFrameEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "replay-passed",
            ["tick"] = terminalTick,
            ["scenarioDigest"] = scenarioDigest,
        });
        if (captureFailed)
        {
            AppendRuntimeFrameEvent(transcript, new Dictionary<string, object?>
            {
                ["event"] = "capture-failed",
                ["runId"] = runId,
                ["code"] = "image-unavailable",
                ["tick"] = terminalTick,
                ["scenarioDigest"] = scenarioDigest,
            });
            return transcript.ToString();
        }
        string artifactDigest = "sha256:" + Convert.ToHexString(
            SHA256.HashData(png)).ToLowerInvariant();
        AppendRuntimeFrameEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "capture-passed",
            ["runId"] = runId,
            ["tick"] = terminalTick,
            ["scenarioDigest"] = scenarioDigest,
            ["stateDigest"] = terminalStateHash,
            ["inputBindingDigest"] = inputBindingDigest,
            ["sceneId"] = "scene.graybox.main",
            ["cameraId"] = "camera.follow",
            ["renderer"] = "gl_compatibility",
            ["renderingDriver"] = "opengl3",
            ["displayServer"] = "windows",
            ["engineVersion"] = "4.7.2",
            ["engineStatus"] = "stable",
            ["viewport"] = new Dictionary<string, object?>
            {
                ["width"] = 960,
                ["height"] = 540,
                ["scale"] = "1.000000",
            },
            ["artifactDigest"] = artifactDigest,
            ["artifactBytes"] = png.Length,
        });
        return transcript.ToString();
    }

    private static byte[] BuildRuntimeFramePng()
    {
        const int width = 960;
        const int height = 540;
        byte[] pixels = new byte[height * (1 + width * 4)];
        for (int y = 0; y < height; y += 1)
        {
            int row = y * (1 + width * 4);
            pixels[row] = 0;
            for (int x = 0; x < width; x += 1)
            {
                int pixel = row + 1 + x * 4;
                pixels[pixel] = (byte)(32 + x % 160);
                pixels[pixel + 1] = (byte)(48 + y % 144);
                pixels[pixel + 2] = (byte)(96 + (x + y) % 128);
                pixels[pixel + 3] = 255;
            }
        }
        byte[] compressed;
        using (MemoryStream compressedStream = new())
        {
            using (ZLibStream zlib = new(
                compressedStream,
                CompressionLevel.SmallestSize,
                true))
            {
                zlib.Write(pixels);
            }
            compressed = compressedStream.ToArray();
        }
        using MemoryStream png = new();
        png.Write(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 });
        byte[] header = new byte[13];
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(0, 4), width);
        BinaryPrimitives.WriteUInt32BigEndian(header.AsSpan(4, 4), height);
        header[8] = 8;
        header[9] = 6;
        header[10] = 0;
        header[11] = 0;
        header[12] = 0;
        WritePngChunk(png, "IHDR", header);
        WritePngChunk(png, "IDAT", compressed);
        WritePngChunk(png, "IEND", Array.Empty<byte>());
        return png.ToArray();
    }

    private static void WritePngChunk(
        Stream output,
        string type,
        ReadOnlySpan<byte> data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(length, (uint)data.Length);
        output.Write(length);
        byte[] typeBytes = Encoding.ASCII.GetBytes(type);
        output.Write(typeBytes);
        output.Write(data);
        uint crc = 0xffffffff;
        foreach (byte value in typeBytes)
        {
            crc = UpdateCrc32(crc, value);
        }
        foreach (byte value in data)
        {
            crc = UpdateCrc32(crc, value);
        }
        Span<byte> checksum = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(checksum, crc ^ 0xffffffff);
        output.Write(checksum);
    }

    private static uint UpdateCrc32(uint crc, byte value)
    {
        crc ^= value;
        for (int bit = 0; bit < 8; bit += 1)
        {
            crc = (crc & 1) == 1
                ? 0xedb88320u ^ (crc >> 1)
                : crc >> 1;
        }
        return crc;
    }

    private static async Task<string> BuildProjectValidationTranscriptAsync(
        string project)
    {
        string manifestPath = Path.Combine(project, "manifest.json");
        if (!File.Exists(manifestPath))
        {
            return string.Empty;
        }

        using JsonDocument manifest = JsonDocument.Parse(
            await File.ReadAllTextAsync(manifestPath));
        JsonElement root = manifest.RootElement;
        string projectId = root.GetProperty("projectId").GetString()!;
        string sourceDigest = root.GetProperty("sourceDigest").GetString()!;
        string mainScene = root.GetProperty("mainScene").GetString()!;
        StringBuilder transcript = new();
        AppendProjectValidationEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "validation-started",
            ["projectId"] = projectId,
            ["sourceDigest"] = sourceDigest,
            ["mainScene"] = mainScene,
        });
        AppendProjectValidationEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "validation-passed",
            ["projectId"] = projectId,
            ["sourceDigest"] = sourceDigest,
            ["mainScene"] = mainScene,
            ["resourceType"] = "PackedScene",
            ["rootType"] = "Node3D",
        });
        return transcript.ToString();
    }

    private static async Task<string> BuildPersistenceTranscriptAsync(
        string project,
        string phase,
        byte[] saveBytes)
    {
        (string projectId, string sourceDigest) =
            await PersistenceIdentityAsync(project);
        string saveDigest = "sha256:" + Convert.ToHexString(
            SHA256.HashData(saveBytes)).ToLowerInvariant();
        StringBuilder transcript = new();
        if (phase == "save")
        {
            AppendPersistenceEvent(transcript, new Dictionary<string, object?>
            {
                ["event"] = "persistence-save-started",
                ["projectId"] = projectId,
                ["sourceDigest"] = sourceDigest,
                ["freshStateHash"] =
                    "sha256:1d025ef5d6fbb149d4efc570386222eba43a70940cf840cefe6abcb292a6f7b6",
            });
            AppendPersistenceEvent(transcript, new Dictionary<string, object?>
            {
                ["event"] = "persistence-save-completed",
                ["projectId"] = projectId,
                ["sourceDigest"] = sourceDigest,
                ["stateHash"] =
                    "sha256:d03c747825e76805b014f27fe25efa647c05dcbfb8a80fba68fd26ffecd5cef7",
                ["saveDigest"] = saveDigest,
                ["saveBytes"] = saveBytes.Length,
                ["userfsPersistent"] = true,
            });
            return transcript.ToString();
        }
        AppendPersistenceEvent(transcript, new Dictionary<string, object?>
        {
            ["event"] = "persistence-load-started",
            ["projectId"] = projectId,
            ["sourceDigest"] = sourceDigest,
            ["freshStateHash"] =
                "sha256:1d025ef5d6fbb149d4efc570386222eba43a70940cf840cefe6abcb292a6f7b6",
            ["saveDigest"] = saveDigest,
            ["saveBytes"] = saveBytes.Length,
            ["userfsPersistent"] = true,
        });
        foreach (string name in new[]
                 {
                     "persistence-load-completed",
                     "persistence-cycle-passed",
                 })
        {
            AppendPersistenceEvent(transcript, new Dictionary<string, object?>
            {
                ["event"] = name,
                ["projectId"] = projectId,
                ["sourceDigest"] = sourceDigest,
                ["stateHash"] =
                    "sha256:d03c747825e76805b014f27fe25efa647c05dcbfb8a80fba68fd26ffecd5cef7",
                ["saveDigest"] = saveDigest,
                ["saveBytes"] = saveBytes.Length,
            });
        }
        return transcript.ToString();
    }

    private static async Task<string> BuildPersistenceStartOnlyAsync(
        string project,
        string phase,
        byte[]? saveBytes)
    {
        (string projectId, string sourceDigest) =
            await PersistenceIdentityAsync(project);
        StringBuilder transcript = new();
        var value = new Dictionary<string, object?>
        {
            ["event"] = phase == "save"
                ? "persistence-save-started"
                : "persistence-load-started",
            ["projectId"] = projectId,
            ["sourceDigest"] = sourceDigest,
            ["freshStateHash"] =
                "sha256:1d025ef5d6fbb149d4efc570386222eba43a70940cf840cefe6abcb292a6f7b6",
        };
        if (saveBytes is not null)
        {
            value["saveDigest"] = "sha256:" + Convert.ToHexString(
                SHA256.HashData(saveBytes)).ToLowerInvariant();
            value["saveBytes"] = saveBytes.Length;
            value["userfsPersistent"] = true;
        }
        AppendPersistenceEvent(transcript, value);
        return transcript.ToString();
    }

    private static async Task<(string ProjectId, string SourceDigest)>
        PersistenceIdentityAsync(string project)
    {
        using JsonDocument manifest = JsonDocument.Parse(
            await File.ReadAllTextAsync(Path.Combine(project, "manifest.json")));
        return (
            manifest.RootElement.GetProperty("projectId").GetString()!,
            manifest.RootElement.GetProperty("sourceDigest").GetString()!);
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

    private static void AppendRuntimeFrameEvent(
        StringBuilder transcript,
        Dictionary<string, object?> value)
    {
        transcript.Append("AGPB_RUNTIME_FRAME ");
        transcript.Append(JsonSerializer.Serialize(value));
        transcript.Append('\n');
    }

    private static void AppendProjectValidationEvent(
        StringBuilder transcript,
        Dictionary<string, object?> value)
    {
        transcript.Append("AGPB_PROJECT_VALIDATION ");
        transcript.Append(JsonSerializer.Serialize(value));
        transcript.Append('\n');
    }

    private static void AppendPersistenceEvent(
        StringBuilder transcript,
        Dictionary<string, object?> value)
    {
        transcript.Append("AGPB_PERSISTENCE ");
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

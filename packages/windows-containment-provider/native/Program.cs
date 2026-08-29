using System.Runtime.InteropServices;
using System.Text.Json;

namespace AiGamePlaybook.WindowsContainment;

internal static class Program
{
    internal static async Task<int> Main(string[] args)
    {
        if (!OperatingSystem.IsWindows() || RuntimeInformation.ProcessArchitecture != Architecture.X64)
        {
            WriteError("host-unsupported");
            return 70;
        }

        try
        {
            if (args.Length == 1 && args[0] == "self-test")
            {
                NativeSelfTestRequest request = await Protocol.ReadRequestAsync();
                NativeRunResult result = await SelfTestRunner.RunAsync(request);
                Protocol.WriteJson(result.Report);
                return result.ExitCode;
            }
            if (args.Length == 1 && args[0] == "synthetic-launch")
            {
                NativeSyntheticLaunchRequest request =
                    await Protocol.ReadSyntheticLaunchRequestAsync();
                NativeSyntheticLaunchResult result =
                    await SyntheticLaunchRunner.RunAsync(request);
                Protocol.WriteJson(result.Report);
                return result.ExitCode;
            }
            if (args.Length == 1 && args[0] == "godot-engine-run")
            {
                NativeEngineRunRequest request =
                    await EngineRunProtocol.ReadRequestAsync();
                NativeEngineRunResult result =
                    await EngineRunRunner.RunAsync(request);
                Protocol.WriteJson(result.Report);
                return result.ExitCode;
            }
            if (args.Length == 1 && args[0] == "godot-engine-cancel")
            {
                NativeEngineRunCancellationRequest request =
                    await EngineRunCancellationProtocol.ReadRequestAsync();
                NativeEngineRunCancellationResult result =
                    await EngineRunCancellationRunner.RunAsync(request);
                Protocol.WriteJson(result.Report);
                return result.ExitCode;
            }
            if (args.Length > 1 && args[0] == "synthetic-workload")
            {
                return await SyntheticPayload.RunAsync(args[1..]);
            }
            if (args.Length > 1 && args[0] == "probe")
            {
                return await ProbePayload.RunAsync(args[1..]);
            }
            if (args.Length == 1 && args[0] == "noop")
            {
                return 0;
            }
            throw new ProtocolException("operation-invalid");
        }
        catch (ProtocolException error)
        {
            WriteError(error.Code);
            return 64;
        }
        catch
        {
            WriteError("internal-failure");
            return 70;
        }
    }

    private static void WriteError(string code) =>
        Console.Error.WriteLine(JsonSerializer.Serialize(
            new NativeError("1.0.0", "error", code),
            Protocol.JsonOptions));
}

internal sealed record NativeError(string SchemaVersion, string Status, string Code);

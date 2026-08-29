export type WindowsContainmentProviderErrorCode =
  | "invalid-provider-artifact-request"
  | "provider-artifact-unavailable"
  | "provider-artifact-invalid"
  | "provider-artifact-drift"
  | "provider-runtime-invalid"
  | "provider-host-unsupported"
  | "provider-host-environment-invalid"
  | "invalid-self-test-request"
  | "self-test-consumed"
  | "self-test-expired"
  | "self-test-process-failed"
  | "self-test-output-invalid"
  | "self-test-witness-invalid"
  | "self-test-witness-consumed"
  | "invalid-launch-request"
  | "launch-consumed"
  | "launch-expired"
  | "launch-process-failed"
  | "launch-output-invalid"
  | "launch-witness-invalid"
  | "launch-witness-consumed"
  | "invalid-engine-admission-request"
  | "engine-admission-invalid"
  | "engine-admission-expired"
  | "engine-admission-consumed";

export class WindowsContainmentProviderError extends Error {
  readonly code: WindowsContainmentProviderErrorCode;
  readonly mutationUncertain: boolean;

  constructor(
    code: WindowsContainmentProviderErrorCode,
    message: string,
    mutationUncertain = false,
  ) {
    super(message);
    this.name = "WindowsContainmentProviderError";
    this.code = code;
    this.mutationUncertain = mutationUncertain;
  }
}

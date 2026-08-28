import type {
  ApprovalSessionDecision,
  ApprovalSessionResponse,
} from "@ai-game-playbook/contracts";
import { approvalSessionResponseSchema } from "@ai-game-playbook/contracts";
import {
  inspectPermissionApprovalSession,
  resolvePermissionApprovalSession,
  withLocalApprovalGrantSigner,
  type ApprovalGrantSigner,
  type LocalApprovalSigningKey,
  type PermissionApprovalSession,
  type PermissionApprovalSessionPresentation,
  type PermissionApprovalSessionResolution,
} from "@ai-game-playbook/core";
import { isProxy } from "node:util/types";

import { CodexApprovalBoundaryError } from "./errors.js";

export const CODEX_APPROVAL_HOST_ID = "host.codex-local" as const;
export const CODEX_APPROVAL_MAX_WAIT_MS = 300_000;

export type CodexApprovalPresentationHandler = (
  presentation: PermissionApprovalSessionPresentation,
  signal: AbortSignal,
) => ApprovalSessionDecision | Promise<ApprovalSessionDecision>;

export interface CodexApprovalPresenter {
  readonly hostId: typeof CODEX_APPROVAL_HOST_ID;
}

interface PresenterState {
  readonly present: CodexApprovalPresentationHandler;
}

type PresentationOutcome =
  | { readonly kind: "decision"; readonly decision: unknown }
  | { readonly kind: "caller-cancelled" }
  | { readonly kind: "deadline" }
  | { readonly kind: "host-failed" };

const presenterStates = new WeakMap<object, PresenterState>();
const activeSessions = new WeakSet<object>();
const DECISIONS = new Set<ApprovalSessionDecision>([
  "approved",
  "denied",
  "cancelled",
]);

function approvalError(
  code: ConstructorParameters<typeof CodexApprovalBoundaryError>[0],
  message: string,
): CodexApprovalBoundaryError {
  return new CodexApprovalBoundaryError(code, message);
}

function presenterState(value: unknown): PresenterState {
  if (
    value === null ||
    typeof value !== "object" ||
    isProxy(value)
  ) {
    throw approvalError(
      "codex-approval-presenter-invalid",
      "Codex approval presenter must be created in this process.",
    );
  }
  const state = presenterStates.get(value);
  if (state === undefined) {
    throw approvalError(
      "codex-approval-presenter-invalid",
      "Codex approval presenter must be created in this process.",
    );
  }
  return state;
}

function approvalResponse(
  session: PermissionApprovalSession,
  decision: ApprovalSessionDecision,
): ApprovalSessionResponse {
  return Object.freeze({
    schemaVersion: approvalSessionResponseSchema.version,
    sessionId: session.presentation.session.sessionId,
    sessionDigest: session.presentation.session.sessionDigest,
    promptDigest: session.presentation.prompt.promptDigest,
    decision,
  });
}

function cancelledSession(
  session: PermissionApprovalSession,
): Promise<PermissionApprovalSessionResolution> {
  return resolvePermissionApprovalSession(
    session,
    approvalResponse(session, "cancelled"),
  );
}

function validatedCallerSignal(
  signal: AbortSignal | undefined,
): AbortSignal | undefined {
  if (
    signal !== undefined &&
    (typeof signal !== "object" ||
      signal === null ||
      isProxy(signal) ||
      !(signal instanceof AbortSignal))
  ) {
    throw approvalError(
      "codex-approval-session-invalid",
      "Codex approval cancellation must use a genuine AbortSignal.",
    );
  }
  return signal;
}

function callerAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function presentationPromise(
  state: PresenterState,
  presentation: PermissionApprovalSessionPresentation,
  signal: AbortSignal,
): Promise<PresentationOutcome> {
  return Promise.resolve()
    .then(() => state.present(presentation, signal))
    .then(
      (decision): PresentationOutcome => ({ kind: "decision", decision }),
      (): PresentationOutcome => ({ kind: "host-failed" }),
    );
}

export function createCodexApprovalPresenter(
  present: CodexApprovalPresentationHandler,
): CodexApprovalPresenter {
  if (typeof present !== "function" || isProxy(present)) {
    throw approvalError(
      "codex-approval-presenter-invalid",
      "Codex approval presenter requires one direct host callback.",
    );
  }
  const presenter = Object.freeze({ hostId: CODEX_APPROVAL_HOST_ID });
  presenterStates.set(presenter, Object.freeze({ present }));
  return presenter;
}

export async function runCodexApprovalSession(
  session: PermissionApprovalSession,
  presenter: CodexApprovalPresenter,
  signer?: ApprovalGrantSigner,
  callerSignal?: AbortSignal,
): Promise<PermissionApprovalSessionResolution> {
  const host = presenterState(presenter);
  const signal = validatedCallerSignal(callerSignal);
  const snapshot = inspectPermissionApprovalSession(session);
  if (session.presentation.session.hostId !== CODEX_APPROVAL_HOST_ID) {
    throw approvalError(
      "codex-approval-host-mismatch",
      "Approval session is not bound to the local Codex host.",
    );
  }
  if (snapshot.status === "expired") {
    return Object.freeze({ status: "expired", session: snapshot });
  }
  if (snapshot.status !== "pending") {
    throw approvalError(
      "codex-approval-session-settled",
      "Codex approval session is no longer pending.",
    );
  }
  if (activeSessions.has(session)) {
    throw approvalError(
      "codex-approval-session-active",
      "Codex approval session already has an active presentation.",
    );
  }

  const remaining =
    Date.parse(session.presentation.session.expiresAt) - Date.now();
  if (!Number.isSafeInteger(remaining) || remaining > CODEX_APPROVAL_MAX_WAIT_MS) {
    throw approvalError(
      "codex-approval-session-invalid",
      "Codex approval session exceeds the bounded host wait window.",
    );
  }

  activeSessions.add(session);
  try {
    if (callerAborted(signal) || remaining <= 0) {
      return await cancelledSession(session);
    }

    const hostController = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onCallerAbort: (() => void) | undefined;
    const interruption = new Promise<PresentationOutcome>((resolve) => {
      timer = setTimeout(() => {
        resolve({ kind: "deadline" });
        hostController.abort();
      }, remaining);
      if (signal !== undefined) {
        onCallerAbort = () => {
          resolve({ kind: "caller-cancelled" });
          hostController.abort();
        };
        signal.addEventListener("abort", onCallerAbort, { once: true });
        if (signal.aborted) onCallerAbort();
      }
    });
    let outcome: PresentationOutcome;
    try {
      outcome = await Promise.race([
        presentationPromise(
          host,
          session.presentation,
          hostController.signal,
        ),
        interruption,
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (signal !== undefined && onCallerAbort !== undefined) {
        signal.removeEventListener("abort", onCallerAbort);
      }
    }

    if (
      callerAborted(signal) ||
      Date.now() >= Date.parse(session.presentation.session.expiresAt)
    ) {
      hostController.abort();
      return await cancelledSession(session);
    }
    if (outcome.kind === "caller-cancelled" || outcome.kind === "deadline") {
      return await cancelledSession(session);
    }
    if (outcome.kind === "host-failed") {
      await cancelledSession(session);
      throw approvalError(
        "codex-approval-host-failed",
        "Codex approval host did not return a decision.",
      );
    }
    if (
      typeof outcome.decision !== "string" ||
      !DECISIONS.has(outcome.decision as ApprovalSessionDecision)
    ) {
      await cancelledSession(session);
      throw approvalError(
        "codex-approval-decision-invalid",
        "Codex approval host returned an invalid decision.",
      );
    }
    const decision = outcome.decision as ApprovalSessionDecision;
    return await resolvePermissionApprovalSession(
      session,
      approvalResponse(session, decision),
      decision === "approved" ? signer : undefined,
    );
  } finally {
    activeSessions.delete(session);
  }
}

export async function runCodexLocalApprovalSession(
  session: PermissionApprovalSession,
  presenter: CodexApprovalPresenter,
  signingKey: LocalApprovalSigningKey,
  callerSignal?: AbortSignal,
): Promise<PermissionApprovalSessionResolution> {
  const snapshot = inspectPermissionApprovalSession(session);
  const expiresAt = session.presentation.session.expiresAt;
  const remaining = Date.parse(expiresAt) - Date.now();
  if (
    snapshot.status !== "pending" ||
    !Number.isSafeInteger(remaining) ||
    remaining <= 0 ||
    remaining > CODEX_APPROVAL_MAX_WAIT_MS
  ) {
    return runCodexApprovalSession(
      session,
      presenter,
      undefined,
      callerSignal,
    );
  }
  return withLocalApprovalGrantSigner(
    signingKey,
    {
      expiresAt,
      maxSignatures: session.presentation.session.grantTerms.length,
    },
    (signer) =>
      runCodexApprovalSession(session, presenter, signer, callerSignal),
  );
}

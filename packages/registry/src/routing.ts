import { createRequire } from "node:module";

import {
  taskRoutingSelectionSchema,
  type TaskRoutingSelection,
} from "@ai-game-playbook/contracts";
import {
  Ajv2020,
  type AnySchemaObject,
  type ErrorObject,
  type ValidateFunction,
} from "ajv/dist/2020.js";
import type { FormatsPlugin } from "ajv-formats";

import {
  TaskRoutingSelectionError,
  type TaskRoutingDiagnostic,
  type TaskRoutingDiagnosticCode,
} from "./routing-errors.js";
import type { ValidatedRegistry } from "./types.js";
import {
  assertValidatedRegistry,
  cloneBoundedInput,
} from "./validation.js";

const moduleRequire = createRequire(import.meta.url);
const addFormats = moduleRequire("ajv-formats") as FormatsPlugin;
const ajv = new Ajv2020({
  allErrors: true,
  strict: true,
  validateFormats: true,
});
addFormats(ajv, { mode: "full" });
const selectionValidator: ValidateFunction = ajv.compile(
  taskRoutingSelectionSchema.schema as AnySchemaObject,
);

function diagnostic(
  code: TaskRoutingDiagnosticCode,
  path: string,
  message: string,
): TaskRoutingDiagnostic {
  return { code, path, message: message.slice(0, 500) };
}

function schemaMessage(errors: ErrorObject[] | null | undefined): string {
  if (errors === null || errors === undefined || errors.length === 0) {
    return "selection does not satisfy its schema";
  }
  const first = errors[0];
  return `${first?.instancePath ?? ""} ${first?.message ?? "is invalid"}`.trim();
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
    Object.freeze(value);
  }
  return value;
}

function lifecycleIsRoutable(
  lifecycle: string,
  source: TaskRoutingSelection["source"],
): boolean {
  return source === "model"
    ? lifecycle === "stable"
    : lifecycle === "stable" || lifecycle === "experimental";
}

export function validateTaskRoutingSelection(
  registry: ValidatedRegistry,
  input: unknown,
): TaskRoutingSelection {
  assertValidatedRegistry(registry);
  const cloned = cloneBoundedInput(input);
  if (!selectionValidator(cloned)) {
    throw new TaskRoutingSelectionError([
      diagnostic(
        "routing-schema-invalid",
        "$",
        schemaMessage(selectionValidator.errors),
      ),
    ]);
  }

  const selection = cloned as TaskRoutingSelection;
  const diagnostics: TaskRoutingDiagnostic[] = [];
  if (selection.registryDigest !== registry.digest) {
    diagnostics.push(
      diagnostic(
        "routing-registry-digest-mismatch",
        "$.registryDigest",
        "selection registry digest does not match the validated registry",
      ),
    );
  }

  const skills = new Map(registry.skills.map((skill) => [skill.id, skill]));
  for (const [index, skillId] of selection.skills.entries()) {
    const skill = skills.get(skillId);
    const path = `$.skills[${index}]`;
    if (skill === undefined) {
      diagnostics.push(
        diagnostic(
          "routing-skill-missing",
          path,
          "selected skill is not registered",
        ),
      );
      continue;
    }
    if (!skill.supportedStages.includes(selection.stage)) {
      diagnostics.push(
        diagnostic(
          "routing-skill-stage-mismatch",
          path,
          "selected skill does not support the project stage",
        ),
      );
    }
    if (!lifecycleIsRoutable(skill.lifecycle, selection.source)) {
      diagnostics.push(
        diagnostic(
          "routing-lifecycle-not-routable",
          path,
          "selected skill lifecycle is not routable by this source",
        ),
      );
    }
    const invocationAllowed =
      skill.invocation === "both" || skill.invocation === selection.source;
    if (!invocationAllowed) {
      diagnostics.push(
        diagnostic(
          "routing-skill-invocation-mismatch",
          path,
          "selected skill invocation does not allow this source",
        ),
      );
    }
  }

  const roleLenses = new Map(
    registry.roleLenses.map((roleLens) => [roleLens.id, roleLens]),
  );
  for (const [index, roleLensId] of selection.roleLenses.entries()) {
    const roleLens = roleLenses.get(roleLensId);
    const path = `$.roleLenses[${index}]`;
    if (roleLens === undefined) {
      diagnostics.push(
        diagnostic(
          "routing-role-lens-missing",
          path,
          "selected role lens is not registered",
        ),
      );
      continue;
    }
    if (!lifecycleIsRoutable(roleLens.lifecycle, selection.source)) {
      diagnostics.push(
        diagnostic(
          "routing-lifecycle-not-routable",
          path,
          "selected role-lens lifecycle is not routable by this source",
        ),
      );
    }
  }

  if (diagnostics.length > 0) {
    throw new TaskRoutingSelectionError(diagnostics);
  }
  return deepFreeze(selection);
}

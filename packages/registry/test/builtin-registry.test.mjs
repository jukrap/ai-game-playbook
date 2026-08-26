import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import * as registry from "../dist/index.js";

const digestPattern = /^sha256:[0-9a-f]{64}$/;

test("the builtin runtime registry exposes only implemented commands", () => {
  assert.equal(Object.isFrozen(registry.BUILTIN_REGISTRY), true);
  assert.match(registry.BUILTIN_REGISTRY.digest, digestPattern);
  assert.deepEqual(
    registry.BUILTIN_REGISTRY.commands.map(({ id }) => id),
    ["doctor"],
  );

  const doctor = registry.BUILTIN_REGISTRY.commands[0];
  assert.equal(doctor.lifecycle, "experimental");
  assert.deepEqual(doctor.cli, { path: ["doctor"], aliases: [] });
  assert.deepEqual(doctor.permissions, ["read-project"]);
  assert.deepEqual(doctor.sideEffects, [
    { kind: "none", scope: "project-diagnostics", boundary: "local" },
  ]);
  assert.equal(doctor.lane, "parallel-read");
  assert.equal(doctor.input.schemaId, contracts.doctorRequestSchema.schemaId);
  assert.equal(doctor.output.schemaId, contracts.doctorReportSchema.schemaId);
  assert.equal(doctor.handler.package, "@ai-game-playbook/cli");
  assert.equal(doctor.handler.export, "runDoctor");
  assert.match(doctor.handler.digest, digestPattern);
});

test("builtin generated surfaces preserve the doctor schema and command identity", () => {
  const surfaces = registry.BUILTIN_REGISTRY_SURFACES;
  assert.equal(surfaces.registryDigest, registry.BUILTIN_REGISTRY.digest);
  assert.deepEqual(surfaces.cli.data.commands.map(({ id }) => id), ["doctor"]);
  assert.deepEqual(surfaces.docs.data.commands.map(({ id }) => id), ["doctor"]);
  assert.deepEqual(surfaces.mcp.data.tools.map(({ commandId }) => commandId), [
    "doctor",
  ]);
  assert.equal(surfaces.mcp.data.tools[0].enabledByDefault, false);
  assert.equal(
    surfaces.mcp.data.tools[0].outputSchemaId,
    contracts.doctorReportSchema.schemaId,
  );
});

test("builtin registry validates doctor input and output values", () => {
  const doctor = registry.BUILTIN_REGISTRY.commands[0];
  const request = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    doctor.input,
    { schemaVersion: "1.0.0", projectRoot: "D:\\games\\sample" },
  );
  assert.equal(request.projectRoot, "D:\\games\\sample");

  const output = registry.validateRegisteredContractValue(
    registry.BUILTIN_REGISTRY,
    doctor.output,
    {
      schemaVersion: "1.0.0",
      commandId: "doctor",
      status: "attention",
      controlPlaneVersion: "0.0.0",
      registryDigest: registry.BUILTIN_REGISTRY.digest,
      project: {
        requestedPath: "D:\\games\\sample",
        state: "uninitialized",
      },
      checks: [
        {
          id: "project.state",
          status: "warning",
          code: "project-state-not-initialized",
          message: "Project-local runtime state has not been initialized.",
        },
      ],
    },
  );
  assert.equal(output.status, "attention");

  assert.throws(
    () =>
      registry.validateRegisteredContractValue(
        registry.BUILTIN_REGISTRY,
        doctor.input,
        { schemaVersion: "1.0.0", projectRoot: "D:\\games\\sample", extra: true },
      ),
    (error) => error?.code === "registered-value-invalid",
  );
  assert.throws(
    () =>
      registry.validateRegisteredContractValue(
        registry.BUILTIN_REGISTRY,
        doctor.input,
        { schemaVersion: "1.0.0", projectRoot: "D:\\games\\bad\npath" },
      ),
    (error) => error?.code === "registered-value-invalid",
  );
});

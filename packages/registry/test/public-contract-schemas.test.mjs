import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "@ai-game-playbook/contracts";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

import {
  validContractFixtures,
  validOrchestrationDescriptorFixtures,
  validPublicContractFixtures,
} from "./fixtures/public-contracts.mjs";

const publicIds = [
  "asset-provenance",
  "command-descriptor",
  "engine-capability-report",
  "feature-contract",
  "game-project-profile",
  "pack-manifest",
  "run-receipt",
];
const orchestrationIds = [
  "role-lens-descriptor",
  "skill-descriptor",
  "workflow-descriptor",
];

function createValidator() {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    validateFormats: true,
  });
  addFormats(ajv, { mode: "full" });
  return ajv;
}

test("the contracts package exposes the complete versioned schema catalog", () => {
  assert.deepEqual(
    Object.keys(contracts.PUBLIC_CONTRACT_SCHEMAS).sort(),
    publicIds,
  );
  assert.deepEqual(
    Object.keys(contracts.ORCHESTRATION_DESCRIPTOR_SCHEMAS).sort(),
    orchestrationIds,
  );
  assert.deepEqual(
    Object.keys(contracts.ALL_CONTRACT_SCHEMAS).sort(),
    [
      ...publicIds,
      ...orchestrationIds,
      ...Object.keys(contracts.FOUNDATION_PROTOCOL_SCHEMAS),
    ].sort(),
  );

  for (const [id, entry] of Object.entries(contracts.ALL_CONTRACT_SCHEMAS)) {
    assert.equal(entry.id, id);
    assert.equal(entry.version, "1.0.0");
    assert.equal(
      entry.schema.$id,
      `urn:ai-game-playbook:schema:${id}:1.0.0`,
    );
    assert.match(entry.digest, /^sha256:[0-9a-f]{64}$/);
  }
});

test("all public contract and orchestration fixtures validate in strict 2020-12 mode", () => {
  const ajv = createValidator();
  const schemas = {
    ...contracts.PUBLIC_CONTRACT_SCHEMAS,
    ...contracts.ORCHESTRATION_DESCRIPTOR_SCHEMAS,
  };

  for (const [id, entry] of Object.entries(schemas)) {
    const validate = ajv.compile(entry.schema);
    const fixture = validContractFixtures[id];
    assert.notEqual(fixture, undefined, `missing fixture for ${id}`);
    assert.equal(
      validate(fixture),
      true,
      `${id}: ${JSON.stringify(validate.errors)}`,
    );
  }
});

test("every top-level contract is closed to undeclared fields", () => {
  const ajv = createValidator();

  for (const [id, fixture] of Object.entries(validContractFixtures)) {
    const validate = ajv.compile(contracts.ALL_CONTRACT_SCHEMAS[id].schema);
    assert.equal(
      validate({ ...fixture, unexpected: true }),
      false,
      `${id} accepted an undeclared field`,
    );
  }
});

test("every public and orchestration contract rejects a mismatched schema version", () => {
  const ajv = createValidator();

  for (const [id, fixture] of Object.entries(validContractFixtures)) {
    const validate = ajv.compile(contracts.ALL_CONTRACT_SCHEMAS[id].schema);
    assert.equal(
      validate({ ...fixture, schemaVersion: "999.0.0" }),
      false,
      `${id} accepted a mismatched schema version`,
    );
  }
});

test("contract schemas reject unsafe identity, scope, support, and cost shapes", () => {
  const invalidCases = [
    [
      "command-descriptor",
      {
        ...validPublicContractFixtures["command-descriptor"],
        timeoutMs: 0,
      },
    ],
    [
      "pack-manifest",
      {
        ...validPublicContractFixtures["pack-manifest"],
        artifacts: [
          {
            ...validPublicContractFixtures["pack-manifest"].artifacts[0],
            target: "../outside.js",
          },
        ],
      },
    ],
    [
      "pack-manifest",
      {
        ...validPublicContractFixtures["pack-manifest"],
        license: { status: "declared" },
      },
    ],
    [
      "pack-manifest",
      {
        ...validPublicContractFixtures["pack-manifest"],
        license: { status: "unresolved", expression: "MIT" },
      },
    ],
    [
      "game-project-profile",
      { ...validPublicContractFixtures["game-project-profile"], teamSize: 6 },
    ],
    [
      "engine-capability-report",
      {
        ...validPublicContractFixtures["engine-capability-report"],
        capabilities: [
          {
            ...validPublicContractFixtures["engine-capability-report"]
              .capabilities[0],
            support: "supported",
          },
        ],
      },
    ],
    [
      "engine-capability-report",
      {
        ...validPublicContractFixtures["engine-capability-report"],
        capabilities: [
          {
            ...validPublicContractFixtures["engine-capability-report"]
              .capabilities[0],
            evidenceGrade: "implemented",
          },
        ],
      },
    ],
    [
      "engine-capability-report",
      {
        ...validPublicContractFixtures["engine-capability-report"],
        capabilities: [
          (() => {
            const { latestReceiptDigest: _, ...withoutReceipt } =
              validPublicContractFixtures["engine-capability-report"]
                .capabilities[0];
            return withoutReceipt;
          })(),
        ],
      },
    ],
    [
      "engine-capability-report",
      {
        ...validPublicContractFixtures["engine-capability-report"],
        capabilities: [
          {
            ...validPublicContractFixtures["engine-capability-report"]
              .capabilities[0],
            support: "editor-preview",
          },
        ],
      },
    ],
    [
      "engine-capability-report",
      {
        ...validPublicContractFixtures["engine-capability-report"],
        capabilities: [
          {
            ...validPublicContractFixtures["engine-capability-report"]
              .capabilities[0],
            support: "verified",
            latestReceiptDigest:
              validPublicContractFixtures["engine-capability-report"]
                .environmentDigest,
          },
        ],
      },
    ],
    [
      "engine-capability-report",
      {
        ...validPublicContractFixtures["engine-capability-report"],
        capabilities: [
          {
            ...validPublicContractFixtures["engine-capability-report"]
              .capabilities[0],
            support: "planned",
            evidenceGrade: "documented",
          },
        ],
      },
    ],
    [
      "feature-contract",
      {
        ...validPublicContractFixtures["feature-contract"],
        scope: {
          ...validPublicContractFixtures["feature-contract"].scope,
          allowedPaths: [
            {
              path: "../../outside",
              access: "read-write",
              recursive: true,
            },
          ],
        },
      },
    ],
    [
      "feature-contract",
      (() => {
        const { approval: _, ...withoutApproval } =
          validPublicContractFixtures["feature-contract"];
        return withoutApproval;
      })(),
    ],
    [
      "feature-contract",
      (() => {
        const { approval: _, ...withoutApproval } =
          validPublicContractFixtures["feature-contract"];
        return { ...withoutApproval, status: "active" };
      })(),
    ],
    [
      "feature-contract",
      (() => {
        const { approval: _, ...withoutApproval } =
          validPublicContractFixtures["feature-contract"];
        return { ...withoutApproval, status: "completed" };
      })(),
    ],
    [
      "feature-contract",
      (() => {
        const { approval: _, ...withoutApproval } =
          validPublicContractFixtures["feature-contract"];
        return { ...withoutApproval, status: "expired" };
      })(),
    ],
    [
      "feature-contract",
      {
        ...validPublicContractFixtures["feature-contract"],
        rollback: {
          ...validPublicContractFixtures["feature-contract"].rollback,
          preimageRequired: false,
        },
      },
    ],
    [
      "feature-contract",
      {
        ...validPublicContractFixtures["feature-contract"],
        rollback: {
          mode: "not-applicable",
          preimageRequired: true,
          requiredEvidence: [],
        },
      },
    ],
    [
      "feature-contract",
      {
        ...validPublicContractFixtures["feature-contract"],
        rollback: {
          mode: "not-applicable",
          preimageRequired: false,
          commandId: "engine.rollback",
          requiredEvidence: [],
        },
      },
    ],
    [
      "feature-contract",
      {
        ...validPublicContractFixtures["feature-contract"],
        rollback: {
          mode: "not-applicable",
          preimageRequired: false,
          requiredEvidence: ["rollback-state"],
        },
      },
    ],
    [
      "feature-contract",
      {
        ...validPublicContractFixtures["feature-contract"],
        rollback: {
          mode: "required",
          preimageRequired: true,
          requiredEvidence: ["rollback-state"],
        },
      },
    ],
    [
      "feature-contract",
      {
        ...validPublicContractFixtures["feature-contract"],
        rollback: {
          ...validPublicContractFixtures["feature-contract"].rollback,
          requiredEvidence: [],
        },
      },
    ],
    [
      "run-receipt",
      {
        ...validPublicContractFixtures["run-receipt"],
        receiptId: "not-a-uuid",
      },
    ],
    [
      "run-receipt",
      {
        ...validPublicContractFixtures["run-receipt"],
        outcomes: {
          ...validPublicContractFixtures["run-receipt"].outcomes,
          outer: {
            ...validPublicContractFixtures["run-receipt"].outcomes.outer,
            timedOut: true,
          },
        },
      },
    ],
    [
      "run-receipt",
      {
        ...validPublicContractFixtures["run-receipt"],
        outcomes: {
          ...validPublicContractFixtures["run-receipt"].outcomes,
          tests: {
            status: "passed",
            discovered: 0,
            passed: 0,
            failed: 0,
            skipped: 0,
          },
        },
      },
    ],
    [
      "run-receipt",
      {
        ...validPublicContractFixtures["run-receipt"],
        mutation: {
          ...validPublicContractFixtures["run-receipt"].mutation,
          status: "uncertain",
        },
      },
    ],
    [
      "asset-provenance",
      {
        ...validPublicContractFixtures["asset-provenance"],
        cost: {
          ...validPublicContractFixtures["asset-provenance"].cost,
          estimated: 0,
        },
      },
    ],
    [
      "skill-descriptor",
      {
        ...validOrchestrationDescriptorFixtures["skill-descriptor"],
        body: {
          ...validOrchestrationDescriptorFixtures["skill-descriptor"].body,
          path: "C:/private/SKILL.md",
        },
      },
    ],
    [
      "role-lens-descriptor",
      {
        ...validOrchestrationDescriptorFixtures["role-lens-descriptor"],
        maxContextTokens: 0,
      },
    ],
    [
      "workflow-descriptor",
      {
        ...validOrchestrationDescriptorFixtures["workflow-descriptor"],
        steps: [],
      },
    ],
  ];
  const ajv = createValidator();

  for (const [id, fixture] of invalidCases) {
    const validate = ajv.compile(contracts.ALL_CONTRACT_SCHEMAS[id].schema);
    assert.equal(
      validate(fixture),
      false,
      `${id} accepted an unsafe fixture`,
    );
  }
});

test("feature contracts allow a rollback-free draft without approval", () => {
  const ajv = createValidator();
  const validate = ajv.compile(
    contracts.ALL_CONTRACT_SCHEMAS["feature-contract"].schema,
  );
  const { approval: _, ...draft } =
    structuredClone(validPublicContractFixtures["feature-contract"]);
  draft.status = "draft";
  draft.rollback = {
    mode: "not-applicable",
    preimageRequired: false,
    requiredEvidence: [],
  };

  assert.equal(validate(draft), true, JSON.stringify(validate.errors));
});

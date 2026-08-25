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
    [...publicIds, ...orchestrationIds].sort(),
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

  for (const [id, entry] of Object.entries(contracts.ALL_CONTRACT_SCHEMAS)) {
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
      "run-receipt",
      {
        ...validPublicContractFixtures["run-receipt"],
        receiptId: "not-a-uuid",
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

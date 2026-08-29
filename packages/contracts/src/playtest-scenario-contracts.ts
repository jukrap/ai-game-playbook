import {
  defineContractSchema,
  type VersionedContractSchema,
} from "./contract-schema.js";
import { digestCanonicalJson, type Sha256Digest } from "./digest.js";
import {
  boundedArray,
  closedObject,
  contractRoot,
  enumSchema,
  reference,
  textSchema,
} from "./schema-fragments.js";
import type { SemanticVersion } from "./semantic-version.js";
import type { StableId } from "./stable-id.js";

export const PLAYTEST_SCENARIO_MAX_INPUTS = 100_000;
export const PLAYTEST_SCENARIO_MAX_ORACLES = 1_024;
export const PLAYTEST_SCENARIO_MAX_ASSERTIONS = 1_024;
export const PLAYTEST_SCENARIO_MAX_TICKS = 1_000_000_000;
export const PLAYTEST_SCENARIO_MAX_RATE_HZ = 10_000;
export const PLAYTEST_SCENARIO_MAX_WALL_CLOCK_MS = 604_800_000;
export const PLAYTEST_SCENARIO_MAX_OUTPUT_BYTES = 1_073_741_824;
export const PLAYTEST_SCENARIO_MAX_SCREENSHOTS = 1_024;

export type PlaytestClockKind = "physics-tick" | "fixed-tick";
export type PlaytestInputDevice =
  | "keyboard"
  | "mouse"
  | "gamepad"
  | "engine-test-input";
export type PlaytestInputPhase = "pressed" | "held" | "released" | "axis";
export type StateAssertionOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "within"
  | "exists"
  | "absent";

export type PlaytestInputValue = string | readonly [string, string];

export type PlaytestStateValue =
  | { readonly kind: "null" }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "integer"; readonly value: string }
  | { readonly kind: "decimal"; readonly value: string }
  | { readonly kind: "text"; readonly value: string };

export interface PlaytestInputEvent {
  readonly sequence: number;
  readonly tick: number;
  readonly device: PlaytestInputDevice;
  readonly action: StableId;
  readonly phase: PlaytestInputPhase;
  readonly value?: PlaytestInputValue;
}

export interface StateAssertion {
  readonly path: StableId;
  readonly operator: StateAssertionOperator;
  readonly expected?: PlaytestStateValue;
  readonly tolerance?: string;
}

export interface StateOracle {
  readonly oracleId: StableId;
  readonly atTick?: number;
  readonly withinTicks?: {
    readonly firstTick: number;
    readonly lastTick: number;
  };
  readonly assertions: readonly StateAssertion[];
  readonly stateHashFields: readonly StableId[];
  readonly onFailureArtifacts: readonly StableId[];
}

export interface PlaytestScenario {
  readonly schemaVersion: "1.0.0";
  readonly scenarioId: StableId;
  readonly version: SemanticVersion;
  readonly initialState: {
    readonly sceneId: StableId;
    readonly seed: string;
    readonly saveFixture?: string;
    readonly resetProcedure: StableId;
  };
  readonly clock: {
    readonly kind: PlaytestClockKind;
    readonly rateHz: number;
    readonly warmupTicks: number;
    readonly maximumTicks: number;
  };
  readonly inputs: readonly PlaytestInputEvent[];
  readonly checkpoints: readonly StateOracle[];
  readonly terminal: readonly StateOracle[];
  readonly requiredArtifacts: readonly StableId[];
  readonly budgets: {
    readonly wallClockMs: number;
    readonly outputBytes: number;
    readonly screenshots: number;
    readonly repairCycles: number;
  };
}

export interface PlaytestScenarioBinding {
  readonly schemaVersion: "1.0.0";
  readonly bindingId: StableId;
  readonly scenarioDigest: Sha256Digest;
  readonly featureContractDigest: Sha256Digest;
  readonly projectProfileDigest: Sha256Digest;
}

const canonicalNumber = {
  type: "string",
  pattern:
    "^(?!-0(?:\\.0+)?$)-?(?:0|[1-9][0-9]{0,15})(?:\\.[0-9]{1,6})?$",
  maxLength: 24,
};

const canonicalInteger = {
  type: "string",
  pattern: "^(?:0|-?[1-9][0-9]{0,15})$",
  maxLength: 17,
};

const canonicalTolerance = {
  type: "string",
  pattern: "^(?:0|[1-9][0-9]{0,15})(?:\\.[0-9]{1,6})?$",
  maxLength: 23,
};

const inputVector = {
  type: "array",
  prefixItems: [canonicalNumber, canonicalNumber],
  items: false,
  minItems: 2,
  maxItems: 2,
};

const inputValue = {
  oneOf: [canonicalNumber, inputVector],
};

const nullStateValue = closedObject({ kind: { const: "null" } }, ["kind"]);
const booleanStateValue = closedObject(
  { kind: { const: "boolean" }, value: { type: "boolean" } },
  ["kind", "value"],
);
const integerStateValue = closedObject(
  { kind: { const: "integer" }, value: canonicalInteger },
  ["kind", "value"],
);
const decimalStateValue = closedObject(
  { kind: { const: "decimal" }, value: canonicalNumber },
  ["kind", "value"],
);
const textStateValue = closedObject(
  { kind: { const: "text" }, value: textSchema(500, 0) },
  ["kind", "value"],
);
const stateValue = {
  oneOf: [
    nullStateValue,
    booleanStateValue,
    integerStateValue,
    decimalStateValue,
    textStateValue,
  ],
};
const numericStateValue = {
  oneOf: [integerStateValue, decimalStateValue],
};

const inputEventRoot = closedObject(
  {
    sequence: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_INPUTS - 1,
    },
    tick: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
    device: enumSchema([
      "keyboard",
      "mouse",
      "gamepad",
      "engine-test-input",
    ]),
    action: reference("stableId"),
    phase: enumSchema(["pressed", "held", "released", "axis"]),
    value: inputValue,
  },
  ["sequence", "tick", "device", "action", "phase"],
);

const inputEvent = {
  ...inputEventRoot,
  allOf: [
    {
      if: {
        type: "object",
        properties: { phase: { const: "axis" } },
        required: ["phase"],
      },
      then: { required: ["value"], properties: { value: inputValue } },
      else: { properties: { value: false } },
    },
  ],
};

const assertionRoot = closedObject(
  {
    path: reference("stableId"),
    operator: enumSchema([
      "eq",
      "neq",
      "gt",
      "gte",
      "lt",
      "lte",
      "within",
      "exists",
      "absent",
    ]),
    expected: stateValue,
    tolerance: canonicalTolerance,
  },
  ["path", "operator"],
);

const assertion = {
  ...assertionRoot,
  allOf: [
    {
      if: {
        type: "object",
        properties: { operator: { enum: ["exists", "absent"] } },
        required: ["operator"],
      },
      then: { properties: { expected: false, tolerance: false } },
    },
    {
      if: {
        type: "object",
        properties: { operator: { enum: ["eq", "neq"] } },
        required: ["operator"],
      },
      then: {
        required: ["expected"],
        properties: { tolerance: false },
      },
    },
    {
      if: {
        type: "object",
        properties: { operator: { enum: ["gt", "gte", "lt", "lte"] } },
        required: ["operator"],
      },
      then: {
        required: ["expected"],
        properties: { expected: numericStateValue, tolerance: false },
      },
    },
    {
      if: {
        type: "object",
        properties: { operator: { const: "within" } },
        required: ["operator"],
      },
      then: {
        required: ["expected", "tolerance"],
        properties: {
          expected: numericStateValue,
          tolerance: canonicalTolerance,
        },
      },
    },
  ],
};

const tickWindow = closedObject(
  {
    firstTick: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
    lastTick: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
  },
  ["firstTick", "lastTick"],
);

const oracleRoot = closedObject(
  {
    oracleId: reference("stableId"),
    atTick: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
    withinTicks: tickWindow,
    assertions: boundedArray(assertion, {
      minimum: 1,
      maximum: PLAYTEST_SCENARIO_MAX_ASSERTIONS,
    }),
    stateHashFields: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: PLAYTEST_SCENARIO_MAX_ASSERTIONS,
      unique: true,
    }),
    onFailureArtifacts: boundedArray(reference("stableId"), {
      minimum: 1,
      maximum: PLAYTEST_SCENARIO_MAX_ASSERTIONS,
      unique: true,
    }),
  },
  ["oracleId", "assertions", "stateHashFields", "onFailureArtifacts"],
);

const oracle = {
  ...oracleRoot,
  oneOf: [
    {
      required: ["atTick"],
      properties: {
        atTick: {
          type: "integer",
          minimum: 0,
          maximum: PLAYTEST_SCENARIO_MAX_TICKS,
        },
        withinTicks: false,
      },
    },
    {
      required: ["withinTicks"],
      properties: { atTick: false, withinTicks: tickWindow },
    },
  ],
};

const initialState = closedObject(
  {
    sceneId: reference("stableId"),
    seed: { type: "string", minLength: 1, maxLength: 256 },
    saveFixture: reference("portablePath"),
    resetProcedure: reference("stableId"),
  },
  ["sceneId", "seed", "resetProcedure"],
);

const clock = closedObject(
  {
    kind: enumSchema(["physics-tick", "fixed-tick"]),
    rateHz: {
      type: "integer",
      minimum: 1,
      maximum: PLAYTEST_SCENARIO_MAX_RATE_HZ,
    },
    warmupTicks: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
    maximumTicks: {
      type: "integer",
      minimum: 1,
      maximum: PLAYTEST_SCENARIO_MAX_TICKS,
    },
  },
  ["kind", "rateHz", "warmupTicks", "maximumTicks"],
);

const budgets = closedObject(
  {
    wallClockMs: {
      type: "integer",
      minimum: 1,
      maximum: PLAYTEST_SCENARIO_MAX_WALL_CLOCK_MS,
    },
    outputBytes: {
      type: "integer",
      minimum: 1,
      maximum: PLAYTEST_SCENARIO_MAX_OUTPUT_BYTES,
    },
    screenshots: {
      type: "integer",
      minimum: 0,
      maximum: PLAYTEST_SCENARIO_MAX_SCREENSHOTS,
    },
    repairCycles: { type: "integer", minimum: 0, maximum: 3 },
  },
  ["wallClockMs", "outputBytes", "screenshots", "repairCycles"],
);

export const playtestScenarioSchema: VersionedContractSchema =
  defineContractSchema({
    id: "playtest-scenario",
    version: "1.0.0",
    title: "Playtest scenario",
    description:
      "Defines bounded tick-relative player input, state oracles, required artifacts, and execution budgets without engine-specific object identity.",
    schema: contractRoot(
      {
        schemaVersion: { type: "string" },
        scenarioId: reference("stableId"),
        version: reference("semanticVersion"),
        initialState,
        clock,
        inputs: boundedArray(inputEvent, {
          minimum: 1,
          maximum: PLAYTEST_SCENARIO_MAX_INPUTS,
        }),
        checkpoints: boundedArray(oracle, {
          minimum: 1,
          maximum: PLAYTEST_SCENARIO_MAX_ORACLES,
        }),
        terminal: boundedArray(oracle, {
          minimum: 1,
          maximum: PLAYTEST_SCENARIO_MAX_ORACLES,
        }),
        requiredArtifacts: boundedArray(reference("stableId"), {
          minimum: 1,
          maximum: PLAYTEST_SCENARIO_MAX_ASSERTIONS,
          unique: true,
        }),
        budgets,
      },
      [
        "schemaVersion",
        "scenarioId",
        "version",
        "initialState",
        "clock",
        "inputs",
        "checkpoints",
        "terminal",
        "requiredArtifacts",
        "budgets",
      ],
    ),
  });

export const playtestScenarioBindingSchema: VersionedContractSchema =
  defineContractSchema({
    id: "playtest-scenario-binding",
    version: "1.0.0",
    title: "Playtest scenario binding",
    description:
      "Binds one validated engine-neutral scenario to an exact feature contract and engine-specific project profile.",
    schema: contractRoot(
      {
        schemaVersion: { type: "string" },
        bindingId: reference("stableId"),
        scenarioDigest: reference("sha256Digest"),
        featureContractDigest: reference("sha256Digest"),
        projectProfileDigest: reference("sha256Digest"),
      },
      [
        "schemaVersion",
        "bindingId",
        "scenarioDigest",
        "featureContractDigest",
        "projectProfileDigest",
      ],
    ),
  });

export function computePlaytestScenarioDigest(
  scenario: PlaytestScenario,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/playtest-scenario",
    version: "1.0.0",
    scenario,
  });
}

export function computePlaytestScenarioBindingDigest(
  binding: PlaytestScenarioBinding,
): Sha256Digest {
  return digestCanonicalJson({
    domain: "ai-game-playbook/playtest-scenario-binding",
    version: "1.0.0",
    binding,
  });
}

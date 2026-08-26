import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { BUILTIN_REGISTRY_SURFACES } from "@ai-game-playbook/registry";

import {
  McpRuntimeBoundaryError,
  createMcpRuntimePlan,
  invokeMcpTool,
  parseMcpRuntimeArguments,
} from "../dist/index.js";

const serverEntryPoint = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

async function withProject(run) {
  const root = await mkdtemp(join(tmpdir(), "agpb-mcp-project-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("runtime arguments require explicit project, tool allowlist, and host disclosure", () => {
  const parsed = parseMcpRuntimeArguments([
    "--project-root",
    ".",
    "--enable-tool",
    "agpb_doctor",
    "--enable-tool",
    "agpb_project__inspect",
    "--allow-host-disclosure",
  ]);

  assert.deepEqual(parsed, {
    projectRoot: ".",
    enabledTools: ["agpb_doctor", "agpb_project__inspect"],
    allowHostDisclosure: true,
  });
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(Object.isFrozen(parsed.enabledTools), true);

  for (const argv of [
    ["--project-root", ".", "--allow-host-disclosure"],
    ["--project-root", ".", "--enable-tool", "agpb_doctor"],
    ["--enable-tool", "agpb_doctor", "--allow-host-disclosure"],
    [
      "--project-root",
      ".",
      "--enable-tool",
      "agpb_doctor",
      "--enable-tool",
      "agpb_doctor",
      "--allow-host-disclosure",
    ],
    [
      "--project-root",
      ".",
      "--enable-tool",
      "agpb_doctor",
      "--allow-host-disclosure",
      "--unknown",
    ],
    [
      "--project-root",
      "bad\npath",
      "--enable-tool",
      "agpb_doctor",
      "--allow-host-disclosure",
    ],
  ]) {
    assert.throws(
      () => parseMcpRuntimeArguments(argv),
      (error) => error instanceof McpRuntimeBoundaryError,
    );
  }
});

test("runtime plans bind explicit generated read-only tools to one project identity", async () => {
  await withProject(async (root) => {
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_doctor", "agpb_project__inspect"],
      allowHostDisclosure: true,
    });

    assert.equal(Object.isFrozen(plan), true);
    assert.equal(Object.isFrozen(plan.enabledTools), true);
    assert.deepEqual(
      plan.enabledTools.map(({ name }) => name),
      ["agpb_doctor", "agpb_project__inspect"],
    );
    assert.equal(plan.protocolRevision, "2026-07-28");
    assert.equal(plan.transport, "stdio");
    assert.equal(plan.lifecycle, "stateless");
    assert.match(plan.projectIdentityDigest, /^sha256:[0-9a-f]{64}$/u);
    assert.match(plan.registryDigest, /^sha256:[0-9a-f]{64}$/u);

    await assert.rejects(
      () =>
        createMcpRuntimePlan({
          projectRoot: root,
          enabledTools: ["agpb_unknown"],
          allowHostDisclosure: true,
        }),
      (error) =>
        error instanceof McpRuntimeBoundaryError &&
        error.code === "mcp-tool-selection-invalid",
    );
    await assert.rejects(
      () =>
        createMcpRuntimePlan({
          projectRoot: root,
          enabledTools: ["agpb_doctor"],
          allowHostDisclosure: false,
        }),
      (error) =>
        error instanceof McpRuntimeBoundaryError &&
        error.code === "mcp-host-disclosure-required",
    );
  });
});

test("direct invocation validates the exact bound project and emits canonical structured output", async () => {
  await withProject(async (root) => {
    const foreign = await mkdtemp(join(tmpdir(), "agpb-mcp-foreign-"));
    try {
      const plan = await createMcpRuntimePlan({
        projectRoot: root,
        enabledTools: ["agpb_doctor"],
        allowHostDisclosure: true,
      });
      const result = await invokeMcpTool(plan, {
        name: "agpb_doctor",
        arguments: { schemaVersion: "1.0.0", projectRoot: root },
      });

      assert.equal(result.isError, undefined);
      assert.equal(result.structuredContent?.commandId, "doctor");
      assert.equal(result.structuredContent?.project.requestedPath, plan.projectRoot);
      assert.equal(result.content.length, 1);
      assert.equal(result.content[0]?.type, "text");
      assert.deepEqual(
        JSON.parse(result.content[0]?.text ?? ""),
        result.structuredContent,
      );

      const denied = await invokeMcpTool(plan, {
        name: "agpb_doctor",
        arguments: { schemaVersion: "1.0.0", projectRoot: foreign },
      });
      assert.equal(denied.isError, true);
      assert.match(denied.content[0]?.text ?? "", /mcp-project-boundary/u);
      assert.doesNotMatch(denied.content[0]?.text ?? "", new RegExp(foreign.replaceAll("\\", "\\\\"), "u"));

      await assert.rejects(
        () =>
          invokeMcpTool(
            { ...plan },
            {
              name: "agpb_doctor",
              arguments: { schemaVersion: "1.0.0", projectRoot: root },
            },
          ),
        (error) =>
          error instanceof McpRuntimeBoundaryError &&
          error.code === "mcp-runtime-plan-invalid",
      );
    } finally {
      await rm(foreign, { recursive: true, force: true });
    }
  });
});

test("skill tools bind the generated registry handlers and remain write-free", async () => {
  await withProject(async (root) => {
    const before = await readdir(root);
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_skill__list", "agpb_skill__check"],
      allowHostDisclosure: true,
    });
    assert.deepEqual(
      plan.enabledTools.map(({ name }) => name),
      ["agpb_skill__list", "agpb_skill__check"],
    );

    const listed = await invokeMcpTool(plan, {
      name: "agpb_skill__list",
      arguments: { schemaVersion: "1.0.0", projectRoot: root },
    });
    assert.equal(listed.isError, undefined);
    assert.equal(listed.structuredContent?.commandId, "skill.list");
    assert.equal(listed.structuredContent?.materializationAvailable, false);

    const checked = await invokeMcpTool(plan, {
      name: "agpb_skill__check",
      arguments: { schemaVersion: "1.0.0", projectRoot: root },
    });
    assert.equal(checked.isError, undefined);
    assert.equal(checked.structuredContent?.commandId, "skill.check");
    assert.equal(checked.structuredContent?.status, "attention");
    assert.equal(checked.structuredContent?.mutationPerformed, false);
    assert.deepEqual(await readdir(root), before);
  });
});

test(
  "modern stdio transport lists only enabled tools and calls the registered handler",
  { timeout: 20_000 },
  async () => {
    await withProject(async (root) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          serverEntryPoint,
          "--project-root",
          root,
          "--enable-tool",
          "agpb_doctor",
          "--allow-host-disclosure",
        ],
        stderr: "pipe",
      });
      const client = new Client(
        { name: "agpb-test-client", version: "1.0.0" },
        { versionNegotiation: { mode: { pin: "2026-07-28" } } },
      );
      try {
        await client.connect(transport);
        assert.equal(client.getProtocolEra(), "modern");

        const listed = await client.listTools();
        assert.deepEqual(listed.tools.map(({ name }) => name), ["agpb_doctor"]);
        assert.equal(listed.tools[0]?.annotations?.readOnlyHint, true);
        const generated = BUILTIN_REGISTRY_SURFACES.mcp.data.tools.find(
          ({ name }) => name === "agpb_doctor",
        );
        assert.notEqual(generated, undefined);
        assert.deepEqual(listed.tools[0]?.inputSchema, generated.inputSchema);
        assert.deepEqual(listed.tools[0]?.outputSchema, generated.outputSchema);

        const result = await client.callTool({
          name: "agpb_doctor",
          arguments: { schemaVersion: "1.0.0", projectRoot: root },
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.structuredContent?.commandId, "doctor");

        const invalid = await client.callTool({
          name: "agpb_doctor",
          arguments: { projectRoot: root },
        });
        assert.equal(invalid.isError, true);

        await assert.rejects(() =>
          client.callTool({ name: "agpb_unknown", arguments: {} }),
        );
      } finally {
        await client.close();
      }
    });
  },
);

test(
  "modern-only stdio rejects a legacy opening without exposing tools",
  { timeout: 20_000 },
  async () => {
    await withProject(async (root) => {
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          serverEntryPoint,
          "--project-root",
          root,
          "--enable-tool",
          "agpb_doctor",
          "--allow-host-disclosure",
        ],
        stderr: "pipe",
      });
      const legacyClient = new Client({
        name: "agpb-legacy-test-client",
        version: "1.0.0",
      });
      try {
        await assert.rejects(
          () => legacyClient.connect(transport),
          /Unsupported protocol version/u,
        );
      } finally {
        await legacyClient.close();
      }
    });
  },
);

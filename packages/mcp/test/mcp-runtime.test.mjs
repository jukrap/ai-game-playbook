import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { BUILTIN_REGISTRY_SURFACES } from "@ai-game-playbook/registry";

import {
  MCP_STDIO_MAX_BUFFER_BYTES,
  McpRuntimeBoundaryError,
  createMcpRuntimePlan,
  invokeMcpTool,
  parseMcpRuntimeArguments,
} from "../dist/index.js";
import { invokeMcpToolWithSignal } from "../dist/runtime.js";
import { MCP_STDIO_MAX_SESSION_MESSAGES } from "../dist/session-transport.js";
import { MCP_STDIO_MAX_SESSION_RAW_INPUT_BYTES } from "../dist/stdio-input.js";

const serverEntryPoint = fileURLToPath(new URL("../dist/bin.js", import.meta.url));

function waitForChildExit(child, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer;
    const finish = (callback) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    timer = setTimeout(() => {
      child.kill();
      finish(() =>
        reject(new Error("MCP child did not exit within its test deadline")),
      );
    }, timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code, signal) =>
      finish(() => resolve({ code, signal })),
    );
  });
}

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

test("runtime arguments bound project roots by UTF-8 bytes", () => {
  const startupArguments = (projectRoot) => [
    "--project-root",
    projectRoot,
    "--enable-tool",
    "agpb_doctor",
    "--allow-host-disclosure",
  ];

  assert.throws(
    () => parseMcpRuntimeArguments(startupArguments("é".repeat(16_384))),
    (error) =>
      error instanceof McpRuntimeBoundaryError &&
      error.code === "mcp-arguments-invalid",
  );

  const boundary = "é".repeat(16_383) + "x";
  const parsed = parseMcpRuntimeArguments(startupArguments(boundary));
  assert.equal(Buffer.byteLength(parsed.projectRoot, "utf8"), 32_767);
});

test("runtime arguments reject hidden array state and accessors without invoking them", () => {
  const valid = [
    "--project-root",
    ".",
    "--enable-tool",
    "agpb_doctor",
    "--allow-host-disclosure",
  ];
  let getterCalled = false;
  const accessorArguments = [...valid];
  Object.defineProperty(accessorArguments, "0", {
    enumerable: true,
    get() {
      getterCalled = true;
      return "--project-root";
    },
  });
  assert.throws(
    () => parseMcpRuntimeArguments(accessorArguments),
    (error) =>
      error instanceof McpRuntimeBoundaryError &&
      error.code === "mcp-arguments-invalid",
  );
  assert.equal(getterCalled, false);

  class ArgumentList extends Array {}
  for (const hiddenArguments of [
    (() => {
      const value = [...valid];
      Object.defineProperty(value, "provider", { value: "hidden" });
      return value;
    })(),
    Object.assign([...valid], { [Symbol("authority")]: true }),
    new ArgumentList(...valid),
  ]) {
    assert.throws(
      () => parseMcpRuntimeArguments(hiddenArguments),
      (error) =>
        error instanceof McpRuntimeBoundaryError &&
        error.code === "mcp-arguments-invalid",
    );
  }

  let proxyTrapCalled = false;
  const proxiedArguments = new Proxy([...valid], {
    getPrototypeOf(target) {
      proxyTrapCalled = true;
      return Reflect.getPrototypeOf(target);
    },
  });
  assert.throws(
    () => parseMcpRuntimeArguments(proxiedArguments),
    (error) =>
      error instanceof McpRuntimeBoundaryError &&
      error.code === "mcp-arguments-invalid",
  );
  assert.equal(proxyTrapCalled, false);
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

test("runtime plan options reject hidden fields and accessors without invoking them", async () => {
  await withProject(async (root) => {
    let getterCalled = false;
    const accessorOptions = {
      enabledTools: ["agpb_doctor"],
      allowHostDisclosure: true,
    };
    Object.defineProperty(accessorOptions, "projectRoot", {
      enumerable: true,
      get() {
        getterCalled = true;
        return root;
      },
    });
    await assert.rejects(
      createMcpRuntimePlan(accessorOptions),
      (error) =>
        error instanceof McpRuntimeBoundaryError &&
        error.code === "mcp-tool-selection-invalid",
    );
    assert.equal(getterCalled, false);

    for (const hiddenOptions of [
      (() => {
        const value = {
          projectRoot: root,
          enabledTools: ["agpb_doctor"],
          allowHostDisclosure: true,
        };
        Object.defineProperty(value, "provider", { value: "hidden" });
        return value;
      })(),
      {
        projectRoot: root,
        enabledTools: ["agpb_doctor"],
        allowHostDisclosure: true,
        [Symbol("authority")]: true,
      },
    ]) {
      await assert.rejects(
        createMcpRuntimePlan(hiddenOptions),
        (error) =>
          error instanceof McpRuntimeBoundaryError &&
          error.code === "mcp-tool-selection-invalid",
      );
    }

    let proxyTrapCalled = false;
    const proxiedOptions = new Proxy(
      {
        projectRoot: root,
        enabledTools: ["agpb_doctor"],
        allowHostDisclosure: true,
      },
      {
        getPrototypeOf(target) {
          proxyTrapCalled = true;
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    await assert.rejects(
      createMcpRuntimePlan(proxiedOptions),
      (error) =>
        error instanceof McpRuntimeBoundaryError &&
        error.code === "mcp-tool-selection-invalid",
    );
    assert.equal(proxyTrapCalled, false);

    getterCalled = false;
    const accessorTools = [];
    Object.defineProperty(accessorTools, "0", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "agpb_doctor";
      },
    });
    await assert.rejects(
      createMcpRuntimePlan({
        projectRoot: root,
        enabledTools: accessorTools,
        allowHostDisclosure: true,
      }),
      (error) =>
        error instanceof McpRuntimeBoundaryError &&
        error.code === "mcp-tool-selection-invalid",
    );
    assert.equal(getterCalled, false);
  });
});

test("runtime plans reject oversized project roots before filesystem binding", async () => {
  await assert.rejects(
    createMcpRuntimePlan({
      projectRoot: "é".repeat(16_384),
      enabledTools: ["agpb_doctor"],
      allowHostDisclosure: true,
    }),
    (error) =>
      error instanceof McpRuntimeBoundaryError &&
      error.code === "mcp-tool-selection-invalid",
  );
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

test("direct invocation honors caller cancellation before project observation", async () => {
  await withProject(async (root) => {
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_doctor"],
      allowHostDisclosure: true,
    });
    await rm(root, { recursive: true, force: true });
    const caller = new AbortController();
    caller.abort("private caller reason");

    const result = await invokeMcpToolWithSignal(
      plan,
      {
        name: "agpb_doctor",
        arguments: { schemaVersion: "1.0.0", projectRoot: root },
      },
      caller.signal,
    );

    assert.equal(result.isError, true);
    assert.equal(
      JSON.parse(result.content[0]?.text ?? "").code,
      "mcp-command-cancelled",
    );
    assert.doesNotMatch(
      result.content[0]?.text ?? "",
      /private caller reason/u,
    );
  });
});

test("direct invocation rejects hidden fields and accessors without invoking them", async () => {
  await withProject(async (root) => {
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_doctor"],
      allowHostDisclosure: true,
    });
    const arguments_ = { schemaVersion: "1.0.0", projectRoot: root };
    let getterCalled = false;
    const accessorRequest = { arguments: arguments_ };
    Object.defineProperty(accessorRequest, "name", {
      enumerable: true,
      get() {
        getterCalled = true;
        return "agpb_doctor";
      },
    });
    const accessorResult = await invokeMcpTool(plan, accessorRequest);
    assert.equal(accessorResult.isError, true);
    assert.match(
      accessorResult.content[0]?.text ?? "",
      /mcp-command-input-invalid/u,
    );
    assert.equal(getterCalled, false);

    for (const hiddenRequest of [
      (() => {
        const value = { name: "agpb_doctor", arguments: arguments_ };
        Object.defineProperty(value, "provider", { value: "hidden" });
        return value;
      })(),
      {
        name: "agpb_doctor",
        arguments: arguments_,
        [Symbol("authority")]: true,
      },
    ]) {
      const denied = await invokeMcpTool(plan, hiddenRequest);
      assert.equal(denied.isError, true);
      assert.match(
        denied.content[0]?.text ?? "",
        /mcp-command-input-invalid/u,
      );
    }

    let proxyTrapCalled = false;
    const proxiedRequest = new Proxy(
      { name: "agpb_doctor", arguments: arguments_ },
      {
        getPrototypeOf(target) {
          proxyTrapCalled = true;
          return Reflect.getPrototypeOf(target);
        },
      },
    );
    const proxyResult = await invokeMcpTool(plan, proxiedRequest);
    assert.equal(proxyResult.isError, true);
    assert.match(
      proxyResult.content[0]?.text ?? "",
      /mcp-command-input-invalid/u,
    );
    assert.equal(proxyTrapCalled, false);

    getterCalled = false;
    const accessorArgumentsRequest = { name: "agpb_doctor" };
    Object.defineProperty(accessorArgumentsRequest, "arguments", {
      enumerable: true,
      get() {
        getterCalled = true;
        return arguments_;
      },
    });
    const argumentsResult = await invokeMcpTool(
      plan,
      accessorArgumentsRequest,
    );
    assert.equal(argumentsResult.isError, true);
    assert.match(
      argumentsResult.content[0]?.text ?? "",
      /mcp-command-input-invalid/u,
    );
    assert.equal(getterCalled, false);
  });
});

test("direct invocation rejects tool names outside the byte budget before lookup", async () => {
  await withProject(async (root) => {
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_doctor"],
      allowHostDisclosure: true,
    });

    for (const name of [`agpb_${"x".repeat(124)}`, "agpb_é"]) {
      const denied = await invokeMcpTool(plan, {
        name,
        arguments: { schemaVersion: "1.0.0", projectRoot: root },
      });
      assert.equal(denied.isError, true);
      assert.equal(
        JSON.parse(denied.content[0]?.text ?? "").code,
        "mcp-command-input-invalid",
      );
    }

    const boundary = await invokeMcpTool(plan, {
      name: `agpb_${"x".repeat(123)}`,
      arguments: { schemaVersion: "1.0.0", projectRoot: root },
    });
    assert.equal(boundary.isError, true);
    assert.equal(
      JSON.parse(boundary.content[0]?.text ?? "").code,
      "mcp-tool-unavailable",
    );
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

test("pack inspection tools remain project-bound, write-free, and closed to repair input", async () => {
  await withProject(async (root) => {
    const before = await readdir(root);
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_pack__list", "agpb_pack__doctor"],
      allowHostDisclosure: true,
    });
    assert.deepEqual(
      plan.enabledTools.map(({ name }) => name),
      ["agpb_pack__list", "agpb_pack__doctor"],
    );

    const listed = await invokeMcpTool(plan, {
      name: "agpb_pack__list",
      arguments: { schemaVersion: "1.0.0", projectRoot: root },
    });
    assert.equal(listed.isError, undefined);
    assert.equal(listed.structuredContent?.commandId, "pack.list");
    assert.equal(listed.structuredContent?.artifactContentExposed, false);

    const diagnosed = await invokeMcpTool(plan, {
      name: "agpb_pack__doctor",
      arguments: { schemaVersion: "1.0.0", projectRoot: root },
    });
    assert.equal(diagnosed.isError, undefined);
    assert.equal(diagnosed.structuredContent?.commandId, "pack.doctor");
    assert.equal(
      diagnosed.structuredContent?.recoveryFinalizationPerformed,
      false,
    );
    assert.deepEqual(await readdir(root), before);

    for (const [name, extra] of [
      ["agpb_pack__list", { sourceRoot: "D:\\packs" }],
      ["agpb_pack__doctor", { repair: true }],
    ]) {
      const denied = await invokeMcpTool(plan, {
        name,
        arguments: {
          schemaVersion: "1.0.0",
          projectRoot: root,
          ...extra,
        },
      });
      assert.equal(denied.isError, true);
      assert.match(denied.content[0]?.text ?? "", /mcp-command-input-invalid/u);
    }
  });
});

test("engine status MCP tool is project-bound and cannot read a host executable", async () => {
  await withProject(async (root) => {
    await writeFile(
      join(root, "project.godot"),
      'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
      "utf8",
    );
    const before = await readdir(root);
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_engine__status"],
      allowHostDisclosure: true,
    });

    const status = await invokeMcpTool(plan, {
      name: "agpb_engine__status",
      arguments: {
        schemaVersion: "1.0.0",
        projectRoot: root,
        engine: "godot",
      },
    });
    assert.equal(status.isError, undefined);
    assert.equal(status.structuredContent?.commandId, "engine.status");
    assert.equal(status.structuredContent?.support.grade, "planned");
    assert.equal(status.structuredContent?.externalProcessStarted, false);
    assert.deepEqual(await readdir(root), before);

    const denied = await invokeMcpTool(plan, {
      name: "agpb_engine__status",
      arguments: {
        schemaVersion: "1.0.0",
        projectRoot: root,
        engine: "godot",
        executablePath: process.execPath,
      },
    });
    assert.equal(denied.isError, true);
    assert.match(denied.content[0]?.text ?? "", /mcp-command-input-invalid/u);
  });
});

test("engine capabilities MCP tool reports planned operations without authority", async () => {
  await withProject(async (root) => {
    await writeFile(
      join(root, "project.godot"),
      'config_version=5\nconfig/features=PackedStringArray("4.7")\n',
      "utf8",
    );
    const before = await readdir(root);
    const plan = await createMcpRuntimePlan({
      projectRoot: root,
      enabledTools: ["agpb_engine__capabilities"],
      allowHostDisclosure: true,
    });

    const result = await invokeMcpTool(plan, {
      name: "agpb_engine__capabilities",
      arguments: {
        schemaVersion: "1.0.0",
        projectRoot: root,
        engine: "godot",
      },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent?.commandId, "engine.capabilities");
    assert.equal(result.structuredContent?.containment.providerCount, 0);
    assert.equal(result.structuredContent?.containment.launchAvailable, false);
    assert.equal(
      result.structuredContent?.capabilityReport.capabilities.length,
      14,
    );
    assert.equal(result.structuredContent?.externalProcessStarted, false);
    assert.deepEqual(await readdir(root), before);
    assert.deepEqual(
      JSON.parse(result.content[0]?.text ?? ""),
      result.structuredContent,
    );

    for (const extra of [
      { executablePath: process.execPath },
      { providerDescriptor: {} },
      { selfTestReport: {} },
    ]) {
      const denied = await invokeMcpTool(plan, {
        name: "agpb_engine__capabilities",
        arguments: {
          schemaVersion: "1.0.0",
          projectRoot: root,
          engine: "godot",
          ...extra,
        },
      });
      assert.equal(denied.isError, true);
      assert.match(denied.content[0]?.text ?? "", /mcp-command-input-invalid/u);
    }
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

test(
  "stdio EOF terminates the server without an error",
  { timeout: 10_000 },
  async () => {
    await withProject(async (root) => {
      const child = spawn(
        process.execPath,
        [
          serverEntryPoint,
          "--project-root",
          root,
          "--enable-tool",
          "agpb_doctor",
          "--allow-host-disclosure",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.stdin.end();
      const outcome = await waitForChildExit(child);

      assert.deepEqual(outcome, { code: 0, signal: null });
      assert.equal(stderr, "");
    });
  },
);

test(
  "stdio input overflow terminates the server with a bounded diagnostic",
  { timeout: 10_000 },
  async () => {
    await withProject(async (root) => {
      const child = spawn(
        process.execPath,
        [
          serverEntryPoint,
          "--project-root",
          root,
          "--enable-tool",
          "agpb_doctor",
          "--allow-host-disclosure",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.stdin.write(Buffer.alloc(MCP_STDIO_MAX_BUFFER_BYTES + 1, 0x78));
      const outcome = await waitForChildExit(child);

      assert.deepEqual(outcome, { code: 1, signal: null });
      assert.equal(stderr, "agpb-mcp: transport error\n");
    });
  },
);

test(
  "stdio session accepts the exact message boundary and clean EOF",
  { timeout: 10_000 },
  async () => {
    await withProject(async (root) => {
      const child = spawn(
        process.execPath,
        [
          serverEntryPoint,
          "--project-root",
          root,
          "--enable-tool",
          "agpb_doctor",
          "--allow-host-disclosure",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      const notification = `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      })}\n`;
      child.stdin.end(notification.repeat(MCP_STDIO_MAX_SESSION_MESSAGES));
      const outcome = await waitForChildExit(child);

      assert.deepEqual(outcome, { code: 0, signal: null });
      assert.equal(stderr, "");
    });
  },
);

test(
  "stdio session message overflow terminates instead of accumulating work",
  { timeout: 10_000 },
  async () => {
    await withProject(async (root) => {
      const child = spawn(
        process.execPath,
        [
          serverEntryPoint,
          "--project-root",
          root,
          "--enable-tool",
          "agpb_doctor",
          "--allow-host-disclosure",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      const notification = `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      })}\n`;
      child.stdin.write(
        notification.repeat(MCP_STDIO_MAX_SESSION_MESSAGES + 1),
      );
      const outcome = await waitForChildExit(child);

      assert.deepEqual(outcome, { code: 1, signal: null });
      assert.equal(stderr, "agpb-mcp: transport error\n");
    });
  },
);

test(
  "stdio session raw byte overflow terminates below parsed session budgets",
  { timeout: 20_000 },
  async () => {
    await withProject(async (root) => {
      const child = spawn(
        process.execPath,
        [
          serverEntryPoint,
          "--project-root",
          root,
          "--enable-tool",
          "agpb_doctor",
          "--allow-host-disclosure",
        ],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });
      child.stdin.on("error", () => {});

      const notification = {
        jsonrpc: "2.0",
        method: "notifications/initialized",
      };
      const wireMessage = `${" ".repeat(512 * 1_024)}${JSON.stringify(
        notification,
      )}\n`;
      const messageCount = 33;
      assert.ok(
        Buffer.byteLength(wireMessage, "utf8") < MCP_STDIO_MAX_BUFFER_BYTES,
      );
      assert.ok(messageCount < MCP_STDIO_MAX_SESSION_MESSAGES);
      assert.ok(
        Buffer.byteLength(wireMessage.repeat(messageCount), "utf8") >
          MCP_STDIO_MAX_SESSION_RAW_INPUT_BYTES,
      );

      child.stdin.end(wireMessage.repeat(messageCount));
      const outcome = await waitForChildExit(child, 15_000);

      assert.deepEqual(outcome, { code: 1, signal: null });
      assert.equal(stderr, "agpb-mcp: transport error\n");
    });
  },
);

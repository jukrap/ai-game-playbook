import assert from "node:assert/strict";
import test from "node:test";

import * as contracts from "../dist/index.js";

test("portable project paths preserve safe canonical relative text", () => {
  assert.equal(typeof contracts.parsePortableProjectPath, "function");
  assert.equal(typeof contracts.isPortableProjectPath, "function");

  for (const path of [
    ".ai-game-playbook/profile.json",
    "Assets/Player.cs",
    "addons/agpb/runtime_probe.gd",
    `${"a".repeat(255)}/file.bin`,
  ]) {
    assert.equal(contracts.parsePortableProjectPath(path), path);
    assert.equal(contracts.isPortableProjectPath(path), true);
  }
});

test("portable project paths reject ambiguous filesystem spellings", () => {
  for (const path of [
    "",
    ".",
    "..",
    "../outside",
    "safe/../outside",
    "/absolute",
    "C:/absolute",
    "safe\\windows",
    "safe//double",
    "safe/trailing/",
    "safe/file:stream",
    "safe/file.",
    "CON/file.txt",
    "safe/con.txt",
    "safe/AuX.data",
    "safe/COM9.log",
    "safe/lpt1",
    "safe path/file",
    "유니티/Player.cs",
    `${"a".repeat(256)}/file.bin`,
    `${"a".repeat(255)}/${"b".repeat(255)}/x`,
  ]) {
    assert.equal(contracts.isPortableProjectPath(path), false, path);
    assert.throws(
      () => contracts.parsePortableProjectPath(path, "$fixture.path"),
      (error) =>
        error?.name === "ContractValueError" &&
        error?.code === "invalid-portable-project-path" &&
        error?.path === "$fixture.path",
      path,
    );
  }
});

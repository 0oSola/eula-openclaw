import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("start-dev PowerShell launcher delegates to dev-stack start", () => {
  const scriptPath = path.join(projectRoot, "start-dev.ps1");
  const content = readFileSync(scriptPath, "utf8");

  assert.match(content, /\[string\]\$Action = "start"/);
  assert.match(content, /scripts\\dev-stack\.ps1/);
  assert.match(content, /-Action \$Action/);
});

test("start-dev cmd launcher calls the PowerShell launcher", () => {
  const scriptPath = path.join(projectRoot, "start-dev.cmd");
  const content = readFileSync(scriptPath, "utf8");

  assert.match(content, /powershell/i);
  assert.match(content, /start-dev\.ps1/i);
});

test("dev stack runs Codex schema preflight before starting services", () => {
  const stackPath = path.join(projectRoot, "scripts", "dev-stack.ps1");
  const checkPath = path.join(projectRoot, "scripts", "check-codex-app-server-schema.ps1");
  const stack = readFileSync(stackPath, "utf8");

  assert.equal(existsSync(checkPath), true);
  assert.match(stack, /check-codex-app-server-schema\.ps1/);
  assert.match(stack, /CODEX_SCHEMA_AUTO_UPDATE/);
  assert.ok(
    stack.indexOf("check-codex-app-server-schema.ps1") < stack.indexOf("Starting API on port"),
    "schema preflight should run before API process starts",
  );
});

test("Codex schema preflight supports fail-fast and explicit auto update", () => {
  const scriptPath = path.join(projectRoot, "scripts", "check-codex-app-server-schema.ps1");
  const content = readFileSync(scriptPath, "utf8");

  assert.match(content, /CODEX_INTERACTIVE_ENABLED/);
  assert.match(content, /CODEX_BIN/);
  assert.match(content, /CODEX_SCHEMA_AUTO_UPDATE/);
  assert.match(content, /generate-codex-app-server-schema\.ps1/);
  assert.match(content, /codex_cli_version/);
  assert.match(content, /Codex schema pin mismatch/);
});

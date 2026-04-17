import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

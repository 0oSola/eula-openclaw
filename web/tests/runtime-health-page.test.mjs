import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const testsDir = dirname(fileURLToPath(import.meta.url));
const webRoot = join(testsDir, "..");

const apiSource = readFileSync(join(webRoot, "src/lib/api.ts"), "utf8");
const typesSource = readFileSync(join(webRoot, "src/lib/types.ts"), "utf8");
const statusPagePath = join(webRoot, "src/app/status/page.tsx");

assert.match(typesSource, /export type RuntimeHealthStatus = \{/);
assert.match(apiSource, /export async function getRuntimeHealth\(/);
assert.equal(existsSync(statusPagePath), true, "runtime health dashboard page exists at /status");

const statusPageSource = readFileSync(statusPagePath, "utf8");

assert.match(statusPageSource, /getRuntimeHealth/);
assert.match(statusPageSource, /Runtime Health/);
assert.match(statusPageSource, /setInterval/);
assert.match(statusPageSource, /Message Bridge/);
assert.match(statusPageSource, /OpenClaw/);

import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const AXIS_MAP_PATH = new URL("../config/bone_axis_map.eula.json", import.meta.url);

async function loadAxisMap() {
  const text = await readFile(AXIS_MAP_PATH, "utf8");
  return JSON.parse(text);
}

test("Eula bone axis map covers the core pose DSL semantics", async () => {
  const axisMap = await loadAxisMap();
  const semanticMap = axisMap.semantic_to_pmx_axis;

  const requiredMappings = [
    ["右腕", "raise"],
    ["右腕", "open_side"],
    ["右腕", "forward"],
    ["左腕", "raise"],
    ["左腕", "open_side"],
    ["左腕", "backward"],
    ["右ひじ", "bend"],
    ["左ひじ", "bend"],
    ["右手首", "pitch"],
    ["右手首", "yaw"],
    ["右手首", "roll"],
    ["左手首", "pitch"],
    ["左手首", "yaw"],
    ["左手首", "roll"],
    ["上半身", "turn_y"],
    ["上半身", "tilt_z"],
    ["上半身", "lean_x"],
    ["下半身", "turn_y"],
    ["下半身", "tilt_z"],
    ["頭", "turn_y"],
    ["頭", "chin_up"],
    ["センター", "shift_x"],
    ["センター", "shift_y"],
    ["センター", "shift_z"],
  ];

  for (const [bone, semantic] of requiredMappings) {
    const mapping = semanticMap?.[bone]?.[semantic];
    assert.ok(mapping, `${bone}.${semantic} is missing`);
    assert.match(mapping.axis, /^local_[xyz]$/);
    assert.ok(mapping.sign === 1 || mapping.sign === -1);
    assert.notEqual(mapping.confidence, "needs_calibration", `${bone}.${semantic} still needs calibration`);
  }
});

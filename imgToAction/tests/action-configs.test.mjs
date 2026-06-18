import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const ACTION_PATH = new URL("../actions/thinking_chin_edge.json", import.meta.url);
const PROFILE_PATH = new URL("../config/model_profile.eula.json", import.meta.url);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("thinking_chin_edge action config defines the first MoMask-to-VMD recipe", async () => {
  const action = await readJson(ACTION_PATH);

  assert.equal(action.id, "thinking_chin_edge");
  assert.equal(action.generator, "momask");
  assert.equal(action.motion_type, "stationary_upper_body");
  assert.ok(action.contacts.includes("right_wrist_to_chin_edge"));
  assert.equal(action.hand_presets.right, "thinking_relaxed");
  assert.equal(action.hand_presets.left, "soft_rest");
  assert.ok(action.quality_checks.includes("right_wrist_near_chin_edge"));
});

test("Eula model profile defines right wrist chin-edge contact metadata", async () => {
  const profile = await readJson(PROFILE_PATH);
  const contact = profile.contacts?.right_wrist_to_chin_edge;

  assert.equal(profile.id, "eula");
  assert.ok(contact, "right_wrist_to_chin_edge contact is missing");
  assert.equal(contact.target_space, "bone_local");
  assert.equal(typeof contact.target_bone, "string");
  assert.equal(typeof contact.effector_bone, "string");
  assert.deepEqual(contact.target_offset, [0.12, 0.105, 0.09]);
  assert.equal(contact.chain.length, 3);
  assert.equal(contact.phase.start, 0.35);
  assert.equal(contact.phase.full, 0.7);
  assert.equal(contact.phase.end, 1.0);
});

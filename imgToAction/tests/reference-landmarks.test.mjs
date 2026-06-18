import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";

const LANDMARKS_PATH = new URL("../config/reference_landmarks.eula_signature.json", import.meta.url);

test("Eula signature reference landmarks define frame 60 front-view joints", async () => {
  const landmarks = JSON.parse(await readFile(LANDMARKS_PATH, "utf8"));
  const frame = landmarks.frames?.frame_60_front;

  assert.equal(landmarks.image_width, 1024);
  assert.equal(landmarks.image_height, 1536);
  assert.equal(frame?.image, "assets/reference_images/frame_60_front.png");

  const required = [
    "head",
    "neck",
    "right_shoulder",
    "right_elbow",
    "right_wrist",
    "left_shoulder",
    "left_elbow",
    "left_wrist",
    "pelvis",
    "right_knee",
    "right_ankle",
    "left_knee",
    "left_ankle",
  ];

  for (const name of required) {
    const point = frame.landmarks?.[name];
    assert.ok(point, `${name} landmark is missing`);
    assert.equal(typeof point.x, "number", `${name}.x must be numeric`);
    assert.equal(typeof point.y, "number", `${name}.y must be numeric`);
    assert.ok(point.x >= 0 && point.x <= landmarks.image_width, `${name}.x is outside image bounds`);
    assert.ok(point.y >= 0 && point.y <= landmarks.image_height, `${name}.y is outside image bounds`);
    assert.ok(point.weight > 0, `${name}.weight must be positive`);
  }
});

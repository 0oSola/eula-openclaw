import test from "node:test";
import assert from "node:assert/strict";

import { buildLandmarkRequests } from "../tools/export-model-landmarks.mjs";

test("buildLandmarkRequests expands reference landmark map into bone lookup requests", () => {
  const config = {
    model_landmark_map: {
      right_wrist: ["右手首"],
      pelvis: ["下半身", "センター"],
    },
  };

  assert.deepEqual(buildLandmarkRequests(config), [
    { name: "right_wrist", bones: ["右手首"] },
    { name: "pelvis", bones: ["下半身", "センター"] },
  ]);
});

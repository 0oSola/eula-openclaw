import test from "node:test";
import assert from "node:assert/strict";

import {
  axisAngleQuaternion,
  buildParameterSpecs,
  compactPoseBones,
  computeWeightedRmse,
  multiplyQuaternions,
  rankCandidates,
} from "../tools/optimize-direct-pose.mjs";

test("axisAngleQuaternion creates normalized local-axis rotations", () => {
  const quat = axisAngleQuaternion("z", 90);

  assert.equal(Number(quat.x.toFixed(6)), 0);
  assert.equal(Number(quat.y.toFixed(6)), 0);
  assert.equal(Number(quat.z.toFixed(6)), 0.707107);
  assert.equal(Number(quat.w.toFixed(6)), 0.707107);
});

test("multiplyQuaternions composes rotations in local order", () => {
  const identity = { x: 0, y: 0, z: 0, w: 1 };
  const delta = axisAngleQuaternion("x", 30);

  assert.deepEqual(multiplyQuaternions(identity, delta), delta);
});

test("computeWeightedRmse applies similarity alignment before scoring landmarks", () => {
  const reference = {
    pelvis: { x: 50, y: 100, weight: 1 },
    neck: { x: 50, y: 20, weight: 1 },
    right_wrist: { x: 35, y: 42, weight: 2 },
  };
  const projected = {
    pelvis: { x: 150, y: 210 },
    neck: { x: 150, y: 50 },
    right_wrist: { x: 120, y: 94 },
  };

  const report = computeWeightedRmse(reference, projected, {
    anchors: ["pelvis", "neck"],
    landmarks: ["right_wrist"],
  });

  assert.equal(Number(report.weightedRmse.toFixed(3)), 0);
});

test("computeWeightedRmse does not add synthetic shoulder-width error by default", () => {
  const reference = {
    left_shoulder: { x: 100, y: 10, weight: 1 },
    right_shoulder: { x: 0, y: 10, weight: 1 },
    pelvis: { x: 50, y: 100, weight: 1 },
    neck: { x: 50, y: 20, weight: 1 },
  };
  const projected = {
    left_shoulder: { x: 55, y: 10 },
    right_shoulder: { x: 45, y: 10 },
    pelvis: { x: 50, y: 100 },
    neck: { x: 50, y: 20 },
  };

  const report = computeWeightedRmse(reference, projected, {
    anchors: ["pelvis", "neck"],
    landmarks: ["left_shoulder", "right_shoulder"],
  });

  assert.equal(report.errors.shoulder_width, undefined);
});


test("rankCandidates returns the lowest RMSE candidate first", () => {
  const ranked = rankCandidates([
    { name: "bad", report: { weightedRmse: 20 } },
    { name: "good", report: { weightedRmse: 5 } },
  ]);

  assert.equal(ranked[0].name, "good");
});

test("compactPoseBones omits captured PMX rest positions from VMD output", () => {
  const compact = compactPoseBones({
    "\u982d": {
      quaternion: [0, 0, 0, 1],
      position: [0, 10.5, 0.3],
    },
  });

  assert.deepEqual(compact, {
    "\u982d": {
      quaternion: [0, 0, 0, 1],
    },
  });
});

test("buildParameterSpecs keeps front-facing torso and head yaw bounded", () => {
  const specs = buildParameterSpecs();
  const headYaw = specs.find((spec) => spec.bone === "\u982d" && spec.axis === "y");
  const neckYaw = specs.find((spec) => spec.bone === "\u9996" && spec.axis === "y");
  const upperYaw = specs.find((spec) => spec.bone === "\u4e0a\u534a\u8eab" && spec.axis === "y");

  assert.deepEqual(
    [headYaw.min, headYaw.max, neckYaw.min, neckYaw.max, upperYaw.min, upperYaw.max],
    [-12, 12, -10, 10, -8, 8],
  );
});

test("buildParameterSpecs supports arm-only optimization scope", () => {
  const specs = buildParameterSpecs({ scope: "arms" });
  const bones = new Set(specs.map((spec) => spec.bone));

  assert.equal(bones.has("\u53f3\u8155"), true);
  assert.equal(bones.has("\u5de6\u3072\u3058"), true);
  assert.equal(bones.has("\u982d"), false);
  assert.equal(bones.has("\u4e0a\u534a\u8eab"), false);
});

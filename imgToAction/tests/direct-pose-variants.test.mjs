import test from "node:test";
import assert from "node:assert/strict";

import { applyBoneDeltas, safeVariantId } from "../tools/create-direct-pose-variants.mjs";

test("applyBoneDeltas composes local axis rotations on selected keyframes", () => {
  const pose = {
    motion_name: "base",
    keyframes: [
      {
        frame: 0,
        bones: {
          "\u53f3\u8155": { quaternion: [0, 0, 0, 1] },
        },
      },
      {
        frame: 60,
        bones: {
          "\u53f3\u8155": { quaternion: [0, 0, 0, 1] },
        },
      },
    ],
  };

  const next = applyBoneDeltas(pose, {
    frames: [60],
    deltas: {
      "\u53f3\u8155": { z: 90 },
    },
  });

  assert.deepEqual(next.keyframes[0].bones["\u53f3\u8155"].quaternion, [0, 0, 0, 1]);
  assert.deepEqual(next.keyframes[1].bones["\u53f3\u8155"].quaternion.map((value) => Number(value.toFixed(6))), [
    0,
    0,
    0.707107,
    0.707107,
  ]);
});

test("safeVariantId creates stable ascii file names from bone deltas", () => {
  assert.equal(safeVariantId({ "\u5de6\u3072\u3058": { x: -15 }, "\u53f3\u624b\u9996": { z: 5 } }), "Lelbow_x_m15_Rwrist_z_p5");
});

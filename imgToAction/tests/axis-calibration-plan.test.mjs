import test from "node:test";
import assert from "node:assert/strict";

import {
  buildAxisCalibrationCapturePlan,
  formatCaptureFilename,
  parseScheduleCsv,
} from "../tools/axis-calibration-plan.mjs";

test("parseScheduleCsv normalizes rotation schedule rows", () => {
  const rows = parseScheduleCsv(`test_no,bone,axis,sign,degree,start_frame,target_frame,hold_frame,reset_frame,note
1,右腕,X,+,35,20,32,44,56,right upper arm
2,左ひじ,Z,-,-45,65,77,89,101,left elbow`);

  assert.deepEqual(rows, [
    {
      testNo: 1,
      bone: "右腕",
      axis: "X",
      sign: "+",
      amount: 35,
      startFrame: 20,
      targetFrame: 32,
      holdFrame: 44,
      resetFrame: 56,
      note: "right upper arm",
    },
    {
      testNo: 2,
      bone: "左ひじ",
      axis: "Z",
      sign: "-",
      amount: -45,
      startFrame: 65,
      targetFrame: 77,
      holdFrame: 89,
      resetFrame: 101,
      note: "left elbow",
    },
  ]);
});

test("formatCaptureFilename creates stable per-frame screenshot names", () => {
  assert.equal(
    formatCaptureFilename({
      group: "upper_body",
      testNo: 7,
      bone: "左腕",
      axis: "Y",
      sign: "-",
      frameKind: "hold",
      frame: 449,
    }),
    "upper_body/007-左腕-Y-minus-hold-f0449.png",
  );
});

test("buildAxisCalibrationCapturePlan expands schedules into render captures", () => {
  const plan = buildAxisCalibrationCapturePlan({
    schedules: [
      {
        group: "upper_body",
        vmdPath: "calibration/upper_body/eula_axis_calibration_upper_body.vmd",
        csvText: `test_no,bone,axis,sign,degree,start_frame,target_frame,hold_frame,reset_frame,note
1,右腕,X,+,35,20,32,44,56,right upper arm`,
      },
      {
        group: "ik_center",
        vmdPath: "calibration/ik_center/eula_axis_calibration_ik_center_position.vmd",
        csvText: `test_no,bone,axis,sign,amount,start_frame,target_frame,hold_frame,reset_frame,note
1,右足ＩＫ,Z,-,-0.8,20,32,44,56,translation test`,
      },
    ],
    frameKinds: ["target", "hold"],
  });

  assert.equal(plan.steps.length, 2);
  assert.deepEqual(plan.steps[0].captures.map((item) => item.outputPath), [
    "upper_body/001-右腕-X-plus-target-f0032.png",
    "upper_body/001-右腕-X-plus-hold-f0044.png",
  ]);
  assert.deepEqual(plan.steps[1].captures.map((item) => item.amount), [-0.8, -0.8]);
  assert.equal(plan.totalCaptures, 4);
});

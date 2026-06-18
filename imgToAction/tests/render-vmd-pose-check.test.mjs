import test from "node:test";
import assert from "node:assert/strict";

import {
  buildContactSheetHtml,
  defaultBoneLandmarkRequests,
  nearestProjectedSampleDistance,
  parseCameraSnapshot,
  parseFrameList,
  summarizePoseMetrics,
} from "../tools/render-vmd-pose-check.mjs";

test("parseFrameList normalizes comma-separated VMD frames", () => {
  assert.deepEqual(parseFrameList("0, 60,120, 292"), [0, 60, 120, 292]);
  assert.throws(() => parseFrameList("0, nope"), /Invalid frame/);
  assert.throws(() => parseFrameList(""), /At least one frame/);
});

test("parseCameraSnapshot validates explicit render cameras", () => {
  assert.deepEqual(
    parseCameraSnapshot('{"fov":33,"position":[1,2,3],"target":[4,5,6],"locked":true}'),
    { fov: 33, position: [1, 2, 3], target: [4, 5, 6], locked: true },
  );
  assert.equal(parseCameraSnapshot(""), null);
  assert.throws(() => parseCameraSnapshot("{bad json"), /Invalid camera JSON/);
  assert.throws(() => parseCameraSnapshot('{"position":[1,2],"target":[4,5,6]}'), /position/);
});

test("defaultBoneLandmarkRequests uses profile contact bones plus stable Eula fallbacks", () => {
  const profile = {
    contacts: {
      right_wrist_to_chin_edge: {
        target_bone: "\u982d",
        effector_bone: "\u53f3\u624b\u9996",
        render_target_offset: [0, -0.42, 0.18],
      },
    },
  };

  assert.deepEqual(defaultBoneLandmarkRequests(profile), [
    { name: "right_wrist", bones: ["\u53f3\u624b\u9996"] },
    { name: "chin", bones: ["\u982d"], localOffset: [0, -0.42, 0.18], source: "right_wrist_to_chin_edge.render_target_offset" },
    { name: "left_wrist", bones: ["\u5de6\u624b\u9996"] },
    { name: "right_shoulder", bones: ["\u53f3\u80a9"] },
    { name: "right_elbow", bones: ["\u53f3\u3072\u3058"] },
    { name: "left_shoulder", bones: ["\u5de6\u80a9"] },
    { name: "left_elbow", bones: ["\u5de6\u3072\u3058"] },
    { name: "waist", bones: ["\u4e0b\u534a\u8eab", "\u30bb\u30f3\u30bf\u30fc"] },
    { name: "right_hip", bones: ["\u53f3\u8db3"] },
    { name: "right_knee", bones: ["\u53f3\u3072\u3056"] },
    { name: "right_ankle", bones: ["\u53f3\u8db3\u9996"] },
    { name: "left_hip", bones: ["\u5de6\u8db3"] },
    { name: "left_knee", bones: ["\u5de6\u3072\u3056"] },
    { name: "left_ankle", bones: ["\u5de6\u8db3\u9996"] },
  ]);
});

test("defaultBoneLandmarkRequests supports multiple chin contact target offsets", () => {
  const profile = {
    contacts: {
      right_wrist_to_chin_edge: {
        target_bone: "\u982d",
        effector_bone: "\u53f3\u624b\u9996",
        render_target_offsets: [
          [0, -0.42, 0.18],
          [0, -0.42, 1.1],
        ],
      },
    },
  };

  const requests = defaultBoneLandmarkRequests(profile);

  assert.deepEqual(requests[1], {
    name: "chin",
    bones: ["\u982d"],
    localOffsets: [
      [0, -0.42, 0.18],
      [0, -0.42, 1.1],
    ],
    sampleMode: "nearest",
    source: "right_wrist_to_chin_edge.render_target_offsets",
  });
});

test("nearestProjectedSampleDistance measures contact to the nearest target sample", () => {
  const wrist = {
    x: 10,
    y: 10,
    samples: [{ label: "wrist", projected: { x: 10, y: 10, z: 0.9 } }],
  };
  const chin = {
    x: 65,
    y: 10,
    samples: [
      { label: "far_chin_proxy", projected: { x: 110, y: 10, z: 0.9 } },
      { label: "near_chin_edge", projected: { x: 13, y: 14, z: 0.9 } },
    ],
  };

  const result = nearestProjectedSampleDistance(wrist, chin);

  assert.equal(Number(result.distance.toFixed(3)), 5);
  assert.equal(result.sourceSample.label, "wrist");
  assert.equal(result.targetSample.label, "near_chin_edge");
});

test("summarizePoseMetrics reports final-hold contact gates separately from preparation frames", () => {
  const summary = summarizePoseMetrics(
    [
      { frame: 0, right_wrist_to_chin_screen: 220, left_wrist_to_waist_screen: 62 },
      { frame: 120, right_wrist_to_chin_screen: 120, left_wrist_to_waist_screen: 130 },
      { frame: 180, right_wrist_to_chin_screen: 18, left_wrist_to_waist_screen: 77 },
      { frame: 240, right_wrist_to_chin_screen: 9, left_wrist_to_waist_screen: 79 },
      { frame: 292, right_wrist_to_chin_screen: 12, left_wrist_to_waist_screen: 72 },
    ],
    { holdStartFrame: 180, contactPassPixels: 30 },
  );

  assert.equal(summary.right_wrist_to_chin_screen.final_hold_count, 3);
  assert.equal(summary.right_wrist_to_chin_screen.final_hold_avg, 13);
  assert.equal(summary.right_wrist_to_chin_screen.final_hold_max, 18);
  assert.equal(summary.quality_gates.right_wrist_final_hold_under_threshold, true);
  assert.equal(summary.quality_gates.overall_motion_quality, true);
});

test("summarizePoseMetrics rejects unstable contact after the thinking hand reaches the chin", () => {
  const summary = summarizePoseMetrics(
    [
      { frame: 90, right_wrist_to_chin_screen: 180, left_wrist_to_waist_screen: 170 },
      { frame: 178, right_wrist_to_chin_screen: 65, left_wrist_to_waist_screen: 170 },
      { frame: 208, right_wrist_to_chin_screen: 20, left_wrist_to_waist_screen: 170 },
    ],
    {
      holdStartFrame: 178,
      contactPassPixels: 80,
      contactHoldMaxDriftPixels: 25,
      thinkingHandHoldMaxRegressionPixels: 60,
    },
  );

  assert.equal(summary.quality_gates.right_wrist_final_hold_under_threshold, true);
  assert.equal(summary.quality_gates.right_wrist_contact_hold_stable, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_wrist_contact_hold_unstable"],
  );
});

test("summarizePoseMetrics does not count pre-hold approach contact as hold drift", () => {
  const summary = summarizePoseMetrics(
    [
      { frame: 48, right_wrist_to_chin_screen: 78, left_wrist_to_waist_screen: 170 },
      { frame: 54, right_wrist_to_chin_screen: 38, left_wrist_to_waist_screen: 170 },
      { frame: 60, right_wrist_to_chin_screen: 34, left_wrist_to_waist_screen: 170 },
      { frame: 90, right_wrist_to_chin_screen: 35, left_wrist_to_waist_screen: 170 },
      { frame: 120, right_wrist_to_chin_screen: 34, left_wrist_to_waist_screen: 170 },
    ],
    { holdStartFrame: 60, contactPassPixels: 80, contactHoldMaxDriftPixels: 28 },
  );

  assert.equal(summary.quality_gates.right_wrist_contact_hold_stable, true);
  assert.equal(summary.quality_gates.overall_motion_quality, true);
});

test("summarizePoseMetrics rejects final contact hold when arm pose keeps drifting", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 90,
        right_wrist_to_chin_screen: 180,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 85, left_elbow_degrees: 90 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 35, left_upper_arm_to_torso_degrees: 35 },
      },
      {
        frame: 120,
        right_wrist_to_chin_screen: 42,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 45, left_elbow_degrees: 90 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 42, left_upper_arm_to_torso_degrees: 35 },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 45, left_elbow_degrees: 90 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 42, left_upper_arm_to_torso_degrees: 35 },
      },
      {
        frame: 208,
        right_wrist_to_chin_screen: 44,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 122, left_elbow_degrees: 90 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 70, left_upper_arm_to_torso_degrees: 35 },
      },
    ],
    {
      holdStartFrame: 178,
      contactPassPixels: 80,
      contactHoldMaxDriftPixels: 25,
      contactHoldMaxJointAngleDriftDegrees: 45,
    },
  );

  assert.equal(summary.quality_gates.right_wrist_contact_hold_stable, true);
  assert.equal(summary.quality_gates.right_wrist_contact_pose_stable, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_elbow_contact_pose_drift"],
  );
});

test("summarizePoseMetrics rejects thinking hand moving away after approaching the chin", () => {
  const summary = summarizePoseMetrics(
    [
      { frame: 0, right_wrist_to_chin_screen: 360, left_wrist_to_waist_screen: 185 },
      { frame: 60, right_wrist_to_chin_screen: 70, left_wrist_to_waist_screen: 170 },
      { frame: 90, right_wrist_to_chin_screen: 220, left_wrist_to_waist_screen: 170 },
      { frame: 178, right_wrist_to_chin_screen: 45, left_wrist_to_waist_screen: 170 },
    ],
    {
      holdStartFrame: 178,
      contactPassPixels: 80,
      thinkingHandApproachStartPixels: 160,
      thinkingHandMaxRegressionPixels: 50,
    },
  );

  assert.equal(summary.quality_gates.right_wrist_final_hold_under_threshold, true);
  assert.equal(summary.quality_gates.thinking_hand_approach_phase_coherent, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["thinking_hand_approach_regressed"],
  );
});

test("summarizePoseMetrics rejects thinking hand passing behind the torso after approach starts", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 210,
        left_wrist_to_waist_screen: 170,
        thinking_hand_path: { right_wrist_front_offset_world: -0.1 },
      },
      {
        frame: 90,
        right_wrist_to_chin_screen: 145,
        left_wrist_to_waist_screen: 170,
        thinking_hand_path: { right_wrist_front_offset_world: -0.82 },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        thinking_hand_path: { right_wrist_front_offset_world: 1.35 },
      },
    ],
    {
      holdStartFrame: 178,
      contactPassPixels: 80,
      thinkingHandApproachStartPixels: 160,
      thinkingHandMinFrontOffsetWorld: -0.55,
    },
  );

  assert.equal(summary.quality_gates.thinking_hand_stays_in_front_of_torso, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["thinking_hand_behind_torso"],
  );
});

test("summarizePoseMetrics rejects thinking hand approaching chin from behind the body path", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 0,
        right_wrist_to_chin_screen: 312,
        left_wrist_to_waist_screen: 170,
        thinking_hand_path: { right_wrist_front_offset_world: 0.36 },
      },
      {
        frame: 30,
        right_wrist_to_chin_screen: 140,
        left_wrist_to_waist_screen: 170,
        thinking_hand_path: { right_wrist_front_offset_world: -0.143 },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 37,
        left_wrist_to_waist_screen: 170,
        thinking_hand_path: { right_wrist_front_offset_world: 1.67 },
      },
    ],
    {
      holdStartFrame: 60,
      contactPassPixels: 80,
      thinkingHandApproachStartPixels: 160,
    },
  );

  assert.equal(summary.quality_gates.thinking_hand_stays_in_front_of_torso, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["thinking_hand_behind_torso"],
  );
});

test("summarizePoseMetrics rejects a raise phase that stays on the torso back side before contact", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 0,
        right_wrist_to_chin_screen: 320,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: 0.34 },
      },
      {
        frame: 30,
        right_wrist_to_chin_screen: 215,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: -0.22 },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 120,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: 0.18 },
      },
      {
        frame: 90,
        right_wrist_to_chin_screen: 42,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: 1.55 },
      },
    ],
    {
      holdStartFrame: 90,
      contactPassPixels: 80,
      thinkingHandRaiseStartPixels: 240,
      thinkingHandApproachStartPixels: 160,
    },
  );

  assert.equal(summary.quality_gates.thinking_hand_raise_phase_coherent, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["thinking_hand_raise_behind_torso"],
  );
});

test("summarizePoseMetrics rejects a hold phase that begins before the approach corridor is reached", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 0,
        right_wrist_to_chin_screen: 315,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: 0.36 },
      },
      {
        frame: 30,
        right_wrist_to_chin_screen: 112,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: 0.22 },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 118,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: 0.28 },
      },
      {
        frame: 90,
        right_wrist_to_chin_screen: 46,
        left_wrist_to_waist_screen: 175,
        thinking_hand_path: { right_wrist_front_offset_world: 1.5 },
      },
    ],
    {
      holdStartFrame: 60,
      contactPassPixels: 80,
      thinkingHandRaiseStartPixels: 240,
      thinkingHandApproachStartPixels: 160,
      thinkingHandHoldEntryPixels: 80,
      thinkingHandHoldMaxRegressionPixels: 18,
    },
  );

  assert.equal(summary.quality_gates.thinking_hand_hold_entry_coherent, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["thinking_hand_hold_started_too_early"],
  );
});

test("summarizePoseMetrics rejects support arm locking before thinking hand approaches chin", () => {
  const summary = summarizePoseMetrics(
    [
      { frame: 0, right_wrist_to_chin_screen: 370, left_wrist_to_waist_screen: 185 },
      { frame: 60, right_wrist_to_chin_screen: 211, left_wrist_to_waist_screen: 102 },
      { frame: 120, right_wrist_to_chin_screen: 40, left_wrist_to_waist_screen: 167 },
      { frame: 178, right_wrist_to_chin_screen: 45, left_wrist_to_waist_screen: 170 },
    ],
    { holdStartFrame: 178, contactPassPixels: 80 },
  );

  assert.equal(summary.quality_gates.right_wrist_final_hold_under_threshold, true);
  assert.equal(summary.quality_gates.transition_support_arm_phase_coherent, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["support_arm_locked_before_thinking_hand"],
  );
});

test("summarizePoseMetrics does not treat perspective overlap as support-arm lock", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 247,
        left_wrist_to_waist_screen: 91,
        left_wrist_to_waist_world: 2.64,
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        left_wrist_to_waist_world: 2.1,
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, prematureSupportWorldDistance: 1.4 },
  );

  assert.equal(summary.quality_gates.transition_support_arm_phase_coherent, true);
  assert.equal(summary.quality_gates.overall_motion_quality, true);
  assert.deepEqual(summary.quality_violations, []);
});

test("summarizePoseMetrics rejects support arm lock when screen and world distances are both close", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 247,
        left_wrist_to_waist_screen: 91,
        left_wrist_to_waist_world: 0.92,
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        left_wrist_to_waist_world: 2.1,
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, prematureSupportWorldDistance: 1.4 },
  );

  assert.equal(summary.quality_gates.transition_support_arm_phase_coherent, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["support_arm_locked_before_thinking_hand"],
  );
  assert.equal(summary.quality_violations[0].left_wrist_to_waist_world, 0.92);
});

test("summarizePoseMetrics rejects impossible elbow angles on sampled frames", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 150,
        left_wrist_to_waist_screen: 150,
        joint_angles: { right_elbow_degrees: 8, left_elbow_degrees: 92 },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80 },
  );

  assert.equal(summary.quality_gates.elbow_angles_plausible_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_elbow_angle_out_of_range"],
  );
});

test("summarizePoseMetrics rejects impossible knee angles on sampled frames", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 150,
        left_wrist_to_waist_screen: 150,
        joint_angles: {
          right_elbow_degrees: 90,
          left_elbow_degrees: 90,
          right_knee_degrees: 8,
          left_knee_degrees: 165,
        },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: {
          right_elbow_degrees: 90,
          left_elbow_degrees: 90,
          right_knee_degrees: 165,
          left_knee_degrees: 165,
        },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80 },
  );

  assert.equal(summary.quality_gates.knee_angles_plausible_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_knee_angle_out_of_range"],
  );
});

test("summarizePoseMetrics rejects implausible elbow angle jumps between sampled frames", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 30,
        right_wrist_to_chin_screen: 260,
        left_wrist_to_waist_screen: 180,
        joint_angles: { right_elbow_degrees: 35, left_elbow_degrees: 95 },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 210,
        left_wrist_to_waist_screen: 180,
        joint_angles: { right_elbow_degrees: 165, left_elbow_degrees: 100 },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, elbowAngleMaxDeltaPer30Frames: 95 },
  );

  assert.equal(summary.quality_gates.elbow_angle_temporal_delta_plausible_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_elbow_angle_temporal_jump"],
  );
});

test("summarizePoseMetrics rejects implausible knee angle jumps between sampled frames", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 30,
        right_wrist_to_chin_screen: 260,
        left_wrist_to_waist_screen: 180,
        joint_angles: {
          right_elbow_degrees: 90,
          left_elbow_degrees: 90,
          right_knee_degrees: 170,
          left_knee_degrees: 168,
        },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 210,
        left_wrist_to_waist_screen: 180,
        joint_angles: {
          right_elbow_degrees: 90,
          left_elbow_degrees: 90,
          right_knee_degrees: 35,
          left_knee_degrees: 166,
        },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: {
          right_elbow_degrees: 90,
          left_elbow_degrees: 90,
          right_knee_degrees: 165,
          left_knee_degrees: 165,
        },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, kneeAngleMaxDeltaPer30Frames: 90 },
  );

  assert.equal(summary.quality_gates.knee_angle_temporal_delta_plausible_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_knee_angle_temporal_jump"],
  );
});

test("summarizePoseMetrics rejects unstable ankle stance across sampled frames", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 30,
        right_wrist_to_chin_screen: 250,
        left_wrist_to_waist_screen: 180,
        stance_metrics: {
          right_ankle_world: { x: -0.5, y: 0, z: 0 },
          left_ankle_world: { x: 0.5, y: 0, z: 0 },
        },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 180,
        left_wrist_to_waist_screen: 180,
        stance_metrics: {
          right_ankle_world: { x: -0.05, y: 0, z: 0 },
          left_ankle_world: { x: 0.5, y: 0, z: 0 },
        },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        stance_metrics: {
          right_ankle_world: { x: 0.2, y: 0, z: 0 },
          left_ankle_world: { x: 0.5, y: 0, z: 0 },
        },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, ankleStanceMaxDriftWorld: 0.35 },
  );

  assert.equal(summary.quality_gates.ankle_stance_stable_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_ankle_stance_drift"],
  );
});

test("summarizePoseMetrics rejects impossible shoulder upper-arm direction", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 140,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 172, left_upper_arm_to_torso_degrees: 35 },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 45, left_upper_arm_to_torso_degrees: 35 },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, shoulderAngleMaxDegrees: 155 },
  );

  assert.equal(summary.quality_gates.shoulder_angles_plausible_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_shoulder_angle_out_of_range"],
  );
});

test("summarizePoseMetrics rejects implausible shoulder angle jumps between sampled frames", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 30,
        right_wrist_to_chin_screen: 260,
        left_wrist_to_waist_screen: 180,
        joint_angles: { right_elbow_degrees: 95, left_elbow_degrees: 95 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 20, left_upper_arm_to_torso_degrees: 35 },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 210,
        left_wrist_to_waist_screen: 180,
        joint_angles: { right_elbow_degrees: 100, left_elbow_degrees: 95 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 145, left_upper_arm_to_torso_degrees: 38 },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
        shoulder_angles: { right_upper_arm_to_torso_degrees: 60, left_upper_arm_to_torso_degrees: 38 },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, shoulderAngleMaxDeltaPer30Frames: 90 },
  );

  assert.equal(summary.quality_gates.shoulder_angle_temporal_delta_plausible_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_shoulder_angle_temporal_jump"],
  );
});

test("summarizePoseMetrics rejects limb endpoints inside the torso core volume", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 180,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 75, left_elbow_degrees: 90 },
        body_clearance: {
          right_wrist_to_torso_core_world: 0.31,
          right_elbow_to_torso_core_world: 1.2,
          left_wrist_to_torso_core_world: 1.7,
          left_elbow_to_torso_core_world: 1.9,
        },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
        body_clearance: {
          right_wrist_to_torso_core_world: 1.4,
          right_elbow_to_torso_core_world: 1.2,
          left_wrist_to_torso_core_world: 1.7,
          left_elbow_to_torso_core_world: 1.9,
        },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, torsoCoreMinDistance: 0.55 },
  );

  assert.equal(summary.quality_gates.limb_endpoints_clear_torso_core_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_wrist_torso_core_intrusion"],
  );
});

test("summarizePoseMetrics rejects limb segments crossing the torso core volume", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 60,
        right_wrist_to_chin_screen: 180,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 75, left_elbow_degrees: 90 },
        body_clearance: {
          right_wrist_to_torso_core_world: 1.25,
          right_elbow_to_torso_core_world: 1.1,
          left_wrist_to_torso_core_world: 1.7,
          left_elbow_to_torso_core_world: 1.9,
          right_forearm_to_torso_core_world: 0.18,
          right_upper_arm_to_torso_core_world: 1.0,
          left_forearm_to_torso_core_world: 1.6,
          left_upper_arm_to_torso_core_world: 1.8,
        },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
        body_clearance: {
          right_wrist_to_torso_core_world: 1.4,
          right_elbow_to_torso_core_world: 1.2,
          left_wrist_to_torso_core_world: 1.7,
          left_elbow_to_torso_core_world: 1.9,
          right_forearm_to_torso_core_world: 1.2,
          right_upper_arm_to_torso_core_world: 1.1,
          left_forearm_to_torso_core_world: 1.6,
          left_upper_arm_to_torso_core_world: 1.8,
        },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, torsoCoreSegmentMinDistance: 0.4 },
  );

  assert.equal(summary.quality_gates.limb_endpoints_clear_torso_core_all_frames, true);
  assert.equal(summary.quality_gates.limb_segments_clear_torso_core_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_forearm_torso_core_segment_intrusion"],
  );
});

test("summarizePoseMetrics rejects unstable limb segment lengths across sampled frames", () => {
  const summary = summarizePoseMetrics(
    [
      {
        frame: 30,
        right_wrist_to_chin_screen: 240,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 85, left_elbow_degrees: 90 },
        segment_lengths: {
          right_upper_arm_world: 2.0,
          right_forearm_world: 2.2,
          left_upper_arm_world: 2.1,
          left_forearm_world: 2.2,
        },
      },
      {
        frame: 60,
        right_wrist_to_chin_screen: 180,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
        segment_lengths: {
          right_upper_arm_world: 3.4,
          right_forearm_world: 2.2,
          left_upper_arm_world: 2.1,
          left_forearm_world: 2.2,
        },
      },
      {
        frame: 178,
        right_wrist_to_chin_screen: 45,
        left_wrist_to_waist_screen: 170,
        joint_angles: { right_elbow_degrees: 90, left_elbow_degrees: 90 },
        segment_lengths: {
          right_upper_arm_world: 2.0,
          right_forearm_world: 2.2,
          left_upper_arm_world: 2.1,
          left_forearm_world: 2.2,
        },
      },
    ],
    { holdStartFrame: 178, contactPassPixels: 80, limbSegmentMaxRelativeDeviation: 0.45 },
  );

  assert.equal(summary.quality_gates.limb_segment_lengths_stable_all_frames, false);
  assert.equal(summary.quality_gates.overall_motion_quality, false);
  assert.deepEqual(
    summary.quality_violations.map((violation) => violation.code),
    ["right_upper_arm_world_length_unstable"],
  );
});

test("buildContactSheetHtml embeds screenshots and per-frame metrics", () => {
  const html = buildContactSheetHtml({
    title: "Pose Check",
    createdAt: "2026-06-17T00:00:00.000Z",
    model: "model.pmx",
    vmd: "motion.vmd",
    rows: [
      {
        frame: 240,
        imagePath: "frame_240.png",
        right_wrist_to_chin_screen: 9.1,
        left_wrist_to_waist_screen: 78.7,
        left_wrist_to_waist_world: 1.23,
        body_clearance: {
          right_wrist_to_torso_core_world: 1.01,
          left_wrist_to_torso_core_world: 1.72,
        },
      },
    ],
    summary: {
      quality_gates: {
        right_wrist_final_hold_under_threshold: true,
      },
    },
  });

  assert.match(html, /Pose Check/);
  assert.match(html, /frame_240\.png/);
  assert.match(html, /right wrist to chin: 9\.1px/);
  assert.match(html, /left wrist to waist world: 1\.23u/);
  assert.match(html, /torso core clearance: 1\.01u/);
});

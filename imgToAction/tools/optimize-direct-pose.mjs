#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const MAIN_EULA_MODEL_PATH = "MMD/\u4f18\u83c8_by_\u539f\u795e_339146e6e418d79e85a515b26414c0b0/\u4f18\u83c8.pmx";
const FALLBACK_EULA_MODEL_PATH = "imgToAction/assets/pmx/\u4f18\u83c8.pmx";
const DEFAULT_REFERENCE = "imgToAction/config/reference_landmarks.eula_thinking.json";
const DEFAULT_START_VMD = "imgToAction/outputs/vmd/eula_thinking_chin_edge_bvh_fit04.vmd";
const DEFAULT_OUT = "imgToAction/outputs/fitting/eula_thinking_direct_fit01/direct_pose.json";

const MIME_TYPES = {
  ".bmp": "image/bmp",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".pmx": "application/octet-stream",
  ".pmd": "application/octet-stream",
  ".tga": "application/octet-stream",
  ".vmd": "application/octet-stream",
};

const CONTROLLED_BONES = [
  "\u30bb\u30f3\u30bf\u30fc",
  "\u4e0b\u534a\u8eab",
  "\u4e0a\u534a\u8eab",
  "\u4e0a\u534a\u8eab2",
  "\u9996",
  "\u982d",
  "\u53f3\u80a9",
  "\u53f3\u8155",
  "\u53f3\u3072\u3058",
  "\u53f3\u624b\u9996",
  "\u5de6\u80a9",
  "\u5de6\u8155",
  "\u5de6\u3072\u3058",
  "\u5de6\u624b\u9996",
];

const OPTIMIZED_BONES = [
  "\u4e0a\u534a\u8eab",
  "\u4e0a\u534a\u8eab2",
  "\u9996",
  "\u982d",
  "\u53f3\u80a9",
  "\u53f3\u8155",
  "\u53f3\u3072\u3058",
  "\u53f3\u624b\u9996",
  "\u5de6\u80a9",
  "\u5de6\u8155",
  "\u5de6\u3072\u3058",
  "\u5de6\u624b\u9996",
];

const DEFAULT_SCORE_LANDMARKS = [
  "head",
  "neck",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "pelvis",
];

const DEFAULT_ALIGNMENT_ANCHORS = ["pelvis", "neck", "right_ankle", "left_ankle"];

function round(value, places = 6) {
  if (!Number.isFinite(value)) return value;
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
}

function normalizeQuaternion(quaternion) {
  const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
  if (length <= 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
  return {
    x: quaternion.x / length,
    y: quaternion.y / length,
    z: quaternion.z / length,
    w: quaternion.w / length,
  };
}

export function axisAngleQuaternion(axis, degrees) {
  const radians = (Number(degrees) * Math.PI) / 180;
  const half = radians * 0.5;
  const value = Math.sin(half);
  if (axis === "x") return normalizeQuaternion({ x: value, y: 0, z: 0, w: Math.cos(half) });
  if (axis === "y") return normalizeQuaternion({ x: 0, y: value, z: 0, w: Math.cos(half) });
  if (axis === "z") return normalizeQuaternion({ x: 0, y: 0, z: value, w: Math.cos(half) });
  throw new Error(`Unknown quaternion axis: ${axis}`);
}

export function multiplyQuaternions(left, right) {
  return normalizeQuaternion({
    x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
    y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
    z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
    w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
  });
}

function computeSimilarityTransform(reference, projected, anchors) {
  const pairs = [];
  for (const name of anchors) {
    if (reference[name] && projected[name]) {
      pairs.push({
        source: { x: Number(projected[name].x), y: Number(projected[name].y) },
        target: { x: Number(reference[name].x), y: Number(reference[name].y) },
      });
    }
  }
  if (pairs.length < 2) return { mode: "none", reason: "not_enough_anchors" };

  const sourceCx = pairs.reduce((sum, pair) => sum + pair.source.x, 0) / pairs.length;
  const sourceCy = pairs.reduce((sum, pair) => sum + pair.source.y, 0) / pairs.length;
  const targetCx = pairs.reduce((sum, pair) => sum + pair.target.x, 0) / pairs.length;
  const targetCy = pairs.reduce((sum, pair) => sum + pair.target.y, 0) / pairs.length;

  let numeratorA = 0;
  let numeratorB = 0;
  let denominator = 0;
  for (const pair of pairs) {
    const sx = pair.source.x - sourceCx;
    const sy = pair.source.y - sourceCy;
    const tx = pair.target.x - targetCx;
    const ty = pair.target.y - targetCy;
    numeratorA += sx * tx + sy * ty;
    numeratorB += sx * ty - sy * tx;
    denominator += sx * sx + sy * sy;
  }
  if (denominator <= 1e-8) return { mode: "none", reason: "degenerate_anchors" };

  const a = numeratorA / denominator;
  const b = numeratorB / denominator;
  return {
    mode: "similarity",
    a,
    b,
    scale: Math.hypot(a, b),
    rotationDegrees: (Math.atan2(b, a) * 180) / Math.PI,
    translateX: targetCx - (a * sourceCx - b * sourceCy),
    translateY: targetCy - (b * sourceCx + a * sourceCy),
    anchors: pairs.length,
  };
}

function applyAlignment(projected, alignment) {
  if (alignment.mode !== "similarity") return projected;
  const aligned = {};
  for (const [name, point] of Object.entries(projected)) {
    aligned[name] = {
      ...point,
      rawX: point.x,
      rawY: point.y,
      x: alignment.a * point.x - alignment.b * point.y + alignment.translateX,
      y: alignment.b * point.x + alignment.a * point.y + alignment.translateY,
    };
  }
  return aligned;
}

export function computeWeightedRmse(reference, projected, options = {}) {
  const landmarks = options.landmarks || DEFAULT_SCORE_LANDMARKS;
  const anchors = options.anchors || DEFAULT_ALIGNMENT_ANCHORS;
  const alignment = computeSimilarityTransform(reference, projected, anchors);
  const aligned = applyAlignment(projected, alignment);
  const errors = {};
  const missing = [];
  let weightedSum = 0;
  let totalWeight = 0;

  for (const name of landmarks) {
    const target = reference[name];
    const observed = aligned[name];
    if (!target || !observed) {
      missing.push(name);
      continue;
    }
    const baseWeight = Number(target.weight ?? 1);
    const emphasis = name === "right_wrist" ? 2.4 : name === "right_elbow" ? 1.8 : name === "left_wrist" ? 2.0 : 1.0;
    const weight = baseWeight * emphasis;
    const dx = Number(observed.x) - Number(target.x);
    const dy = Number(observed.y) - Number(target.y);
    const distance = Math.hypot(dx, dy);
    errors[name] = { dx, dy, distance, weight, target, projected: observed };
    weightedSum += distance * distance * weight;
    totalWeight += weight;
  }

  return {
    weightedRmse: totalWeight ? Math.sqrt(weightedSum / totalWeight) : Number.POSITIVE_INFINITY,
    alignment,
    missing,
    errors,
    worst: Object.entries(errors)
      .map(([name, error]) => ({ name, ...error }))
      .sort((left, right) => right.distance * right.weight - left.distance * left.weight)
      .slice(0, 8),
  };
}

export function rankCandidates(candidates) {
  return [...candidates].sort((left, right) => left.report.weightedRmse - right.report.weightedRmse);
}

function parseArgs(argv) {
  const options = {
    webUrl: "http://127.0.0.1:3100",
    model: defaultModelPath(),
    reference: DEFAULT_REFERENCE,
    frameKey: "frame_60_front",
    startVmd: DEFAULT_START_VMD,
    startFrame: 240,
    startPrepFrame: 0,
    fps: 30,
    passes: 3,
    initialStep: 20,
    scope: "all",
    renderPipeline: "genshin",
    viewportWidth: 1024,
    viewportHeight: 1536,
    out: DEFAULT_OUT,
    report: "",
    headless: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--web-url") {
      options.webUrl = next;
      index += 1;
    } else if (arg === "--model") {
      options.model = next;
      index += 1;
    } else if (arg === "--reference") {
      options.reference = next;
      index += 1;
    } else if (arg === "--frame-key") {
      options.frameKey = next;
      index += 1;
    } else if (arg === "--start-vmd") {
      options.startVmd = next;
      index += 1;
    } else if (arg === "--start-frame") {
      options.startFrame = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--start-prep-frame") {
      options.startPrepFrame = Number.parseInt(next, 10);
      index += 1;
    } else if (arg === "--fps") {
      options.fps = Number.parseInt(next, 10) || options.fps;
      index += 1;
    } else if (arg === "--passes") {
      options.passes = Number.parseInt(next, 10) || options.passes;
      index += 1;
    } else if (arg === "--initial-step") {
      options.initialStep = Number(next) || options.initialStep;
      index += 1;
    } else if (arg === "--scope") {
      options.scope = next || options.scope;
      index += 1;
    } else if (arg === "--render-pipeline") {
      options.renderPipeline = next;
      index += 1;
    } else if (arg === "--viewport") {
      const [width, height] = next.split("x").map((item) => Number.parseInt(item, 10));
      if (Number.isFinite(width) && Number.isFinite(height)) {
        options.viewportWidth = width;
        options.viewportHeight = height;
      }
      index += 1;
    } else if (arg === "--out") {
      options.out = next;
      index += 1;
    } else if (arg === "--report") {
      options.report = next;
      index += 1;
    } else if (arg === "--headful") {
      options.headless = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node imgToAction/tools/optimize-direct-pose.mjs [options]

Options:
  --start-vmd PATH      Seed VMD used for initial local bone quaternions.
  --start-frame N       Frame used as final seed. Default: 240
  --out PATH            Output direct pose JSON.
  --report PATH         Output fitting report JSON.
  --passes N            Coordinate-descent passes. Default: 3
  --initial-step N      Initial axis step in degrees. Default: 20
  --scope NAME          all, arms, right-arm, left-arm, or body. Default: all
`);
}

function defaultModelPath() {
  return existsSync(path.resolve(projectRoot, MAIN_EULA_MODEL_PATH)) ? MAIN_EULA_MODEL_PATH : FALLBACK_EULA_MODEL_PATH;
}

function resolveWithinProject(filePath) {
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectRoot, filePath);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Path is outside project root: ${filePath}`);
  }
  return resolved;
}

function startStaticServer(root) {
  const server = createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://127.0.0.1");
      if (!url.pathname.startsWith("/files/")) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("Not found");
        return;
      }
      const decodedPath = decodeURIComponent(url.pathname.slice("/files/".length));
      const target = path.resolve(root, decodedPath);
      if ((target !== root && !target.startsWith(`${root}${path.sep}`)) || !existsSync(target)) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("Not found");
        return;
      }
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": MIME_TYPES[path.extname(target).toLowerCase()] || "application/octet-stream",
      });
      createReadStream(target).pipe(response);
    } catch (error) {
      response.writeHead(500, { "Access-Control-Allow-Origin": "*" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  });

  return new Promise((resolve, reject) => {
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}` });
    });
  });
}

function toServedUrl(baseUrl, filePath) {
  return `${baseUrl}/files/${path
    .relative(projectRoot, filePath)
    .split(path.sep)
    .map(encodeURIComponent)
    .join("/")}`;
}

async function importPlaywright() {
  const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
  try {
    return requireFromWeb("playwright");
  } catch (error) {
    const packageUrl = pathToFileURL(path.join(projectRoot, "web", "node_modules", "@playwright", "test", "index.js"));
    try {
      return await import(packageUrl.href);
    } catch {
      throw error;
    }
  }
}

async function waitForRuntime(page) {
  await page.waitForFunction(
    () => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd),
    null,
    { timeout: 60_000 },
  );
}

function landmarkRequests(referenceConfig) {
  return Object.entries(referenceConfig.model_landmark_map || {}).map(([name, bones]) => ({
    name,
    bones: Array.isArray(bones) ? bones : [String(bones)],
  }));
}

function referenceLandmarks(referenceConfig, frameKey) {
  const frame = referenceConfig.frames?.[frameKey];
  if (!frame) throw new Error(`Reference frame not found: ${frameKey}`);
  return frame.landmarks || {};
}

export function buildParameterSpecs(options = {}) {
  const scope = options.scope || "all";
  const specs = [];
  const axesByBone = {
    "\u4e0a\u534a\u8eab": { x: [-35, 35], y: [-8, 8], z: [-25, 25] },
    "\u4e0a\u534a\u8eab2": { x: [-35, 35], y: [-10, 10], z: [-25, 25] },
    "\u9996": { x: [-30, 30], y: [-10, 10], z: [-25, 25] },
    "\u982d": { x: [-35, 35], y: [-12, 12], z: [-25, 25] },
    "\u53f3\u80a9": { y: [-50, 50], z: [-50, 50] },
    "\u53f3\u8155": { x: [-85, 85], y: [-85, 85], z: [-85, 85] },
    "\u53f3\u3072\u3058": { x: [-100, 100], y: [-80, 80], z: [-120, 120] },
    "\u53f3\u624b\u9996": { x: [-85, 85], y: [-85, 85], z: [-85, 85] },
    "\u5de6\u80a9": { y: [-50, 50], z: [-50, 50] },
    "\u5de6\u8155": { x: [-85, 85], y: [-85, 85], z: [-85, 85] },
    "\u5de6\u3072\u3058": { x: [-100, 100], y: [-80, 80], z: [-120, 120] },
    "\u5de6\u624b\u9996": { x: [-85, 85], y: [-85, 85], z: [-85, 85] },
  };
  const bodyBones = new Set(["\u4e0a\u534a\u8eab", "\u4e0a\u534a\u8eab2", "\u9996", "\u982d"]);
  const rightArmBones = new Set(["\u53f3\u80a9", "\u53f3\u8155", "\u53f3\u3072\u3058", "\u53f3\u624b\u9996"]);
  const leftArmBones = new Set(["\u5de6\u80a9", "\u5de6\u8155", "\u5de6\u3072\u3058", "\u5de6\u624b\u9996"]);
  const includeBone = (bone) => {
    if (scope === "all") return true;
    if (scope === "body") return bodyBones.has(bone);
    if (scope === "arms") return rightArmBones.has(bone) || leftArmBones.has(bone);
    if (scope === "right-arm") return rightArmBones.has(bone);
    if (scope === "left-arm") return leftArmBones.has(bone);
    throw new Error(`Unknown parameter scope: ${scope}`);
  };
  for (const [bone, axes] of Object.entries(axesByBone)) {
    if (!includeBone(bone)) continue;
    for (const [axis, limits] of Object.entries(axes)) specs.push({ bone, axis, min: limits[0], max: limits[1] });
  }
  return specs;
}

function cloneDeltas(deltas) {
  return JSON.parse(JSON.stringify(deltas));
}

function getDelta(deltas, bone, axis) {
  return Number(deltas[bone]?.[axis] || 0);
}

function setDelta(deltas, bone, axis, value) {
  deltas[bone] = deltas[bone] || {};
  deltas[bone][axis] = value;
}

function poseFromQuaternions({ prep, final, frameKey, source, report }) {
  const keyframes = [
    { frame: 0, bones: prep },
    { frame: 30, bones: prep },
    { frame: 60, bones: final },
    { frame: 90, bones: final },
  ];
  return {
    motion_name: "eula_thinking_direct_fit",
    source,
    frame_key: frameKey,
    fps: 30,
    keyframes,
    report,
  };
}

async function captureSeedPose(page, { startVmdUrl, startPrepFrame, startFrame, fps, bones }) {
  await page.evaluate(async ({ url }) => {
    const runtime = window.__mmdCompanionRuntime;
    runtime?.setCalibrationCaptureMode?.(true);
    const result = await runtime?.playVmd?.(url, 1, [], { disableCrossfade: true });
    runtime?.setCalibrationCaptureMode?.(true);
    if (result === false) throw new Error(`Failed to play VMD: ${url}`);
  }, { url: startVmdUrl });
  await waitForRuntime(page);

  const captureAt = async (frame) =>
    page.evaluate(({ frame, fps, bones }) => {
      const runtime = window.__mmdCompanionRuntime;
      if (runtime?.seekVmdFrame?.(frame, fps) !== true) throw new Error(`Failed to seek frame ${frame}`);
      const model = runtime.model;
      model.updateMatrixWorld?.(true);
      const bonesByName = new Map();
      const visit = (object) => {
        if (!object) return;
        for (const bone of object.skeleton?.bones || []) {
          if (bone?.name && !bonesByName.has(bone.name)) bonesByName.set(bone.name, bone);
        }
        if (object.name && object.isBone && !bonesByName.has(object.name)) bonesByName.set(object.name, object);
        for (const child of object.children || []) visit(child);
      };
      visit(model);
      const captured = {};
      for (const name of bones) {
        const bone = bonesByName.get(name);
        if (!bone) continue;
        captured[name] = {
          quaternion: [
            Number(bone.quaternion.x),
            Number(bone.quaternion.y),
            Number(bone.quaternion.z),
            Number(bone.quaternion.w),
          ],
          position: [Number(bone.position.x), Number(bone.position.y), Number(bone.position.z)],
        };
      }
      return captured;
    }, { frame, fps, bones });

  return {
    prep: await captureAt(startPrepFrame),
    final: await captureAt(startFrame),
  };
}

export function compactPoseBones(bones) {
  const compact = {};
  for (const [name, spec] of Object.entries(bones)) {
    compact[name] = {
      quaternion: spec.quaternion.map((value) => round(value, 8)),
    };
    if (spec.writePosition === true && spec.position && spec.position.some((value) => Math.abs(value) > 1e-8)) {
      compact[name].position = spec.position.map((value) => round(value, 8));
    }
  }
  return compact;
}

async function optimizeInPage(page, { reference, requests, seedFinal, passes, initialStep, scope }) {
  return page.evaluate(
    ({ reference, requests, seedFinal, controlledBones, optimizedBones, parameterSpecs, passes, initialStep, scoreLandmarks, anchors }) => {
      const normalizeQuaternion = (quaternion) => {
        const length = Math.hypot(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
        if (length <= 1e-8) return { x: 0, y: 0, z: 0, w: 1 };
        return {
          x: quaternion.x / length,
          y: quaternion.y / length,
          z: quaternion.z / length,
          w: quaternion.w / length,
        };
      };
      const multiplyQuaternions = (left, right) =>
        normalizeQuaternion({
          x: left.w * right.x + left.x * right.w + left.y * right.z - left.z * right.y,
          y: left.w * right.y - left.x * right.z + left.y * right.w + left.z * right.x,
          z: left.w * right.z + left.x * right.y - left.y * right.x + left.z * right.w,
          w: left.w * right.w - left.x * right.x - left.y * right.y - left.z * right.z,
        });
      const axisAngleQuaternion = (axis, degrees) => {
        const radians = (Number(degrees) * Math.PI) / 180;
        const half = radians * 0.5;
        const value = Math.sin(half);
        if (axis === "x") return normalizeQuaternion({ x: value, y: 0, z: 0, w: Math.cos(half) });
        if (axis === "y") return normalizeQuaternion({ x: 0, y: value, z: 0, w: Math.cos(half) });
        return normalizeQuaternion({ x: 0, y: 0, z: value, w: Math.cos(half) });
      };
      const computeSimilarityTransform = (referencePoints, projectedPoints, anchorNames) => {
        const pairs = [];
        for (const name of anchorNames) {
          if (referencePoints[name] && projectedPoints[name]) {
            pairs.push({
              source: { x: Number(projectedPoints[name].x), y: Number(projectedPoints[name].y) },
              target: { x: Number(referencePoints[name].x), y: Number(referencePoints[name].y) },
            });
          }
        }
        if (pairs.length < 2) return { mode: "none" };
        const sourceCx = pairs.reduce((sum, pair) => sum + pair.source.x, 0) / pairs.length;
        const sourceCy = pairs.reduce((sum, pair) => sum + pair.source.y, 0) / pairs.length;
        const targetCx = pairs.reduce((sum, pair) => sum + pair.target.x, 0) / pairs.length;
        const targetCy = pairs.reduce((sum, pair) => sum + pair.target.y, 0) / pairs.length;
        let numeratorA = 0;
        let numeratorB = 0;
        let denominator = 0;
        for (const pair of pairs) {
          const sx = pair.source.x - sourceCx;
          const sy = pair.source.y - sourceCy;
          const tx = pair.target.x - targetCx;
          const ty = pair.target.y - targetCy;
          numeratorA += sx * tx + sy * ty;
          numeratorB += sx * ty - sy * tx;
          denominator += sx * sx + sy * sy;
        }
        if (denominator <= 1e-8) return { mode: "none" };
        const a = numeratorA / denominator;
        const b = numeratorB / denominator;
        return {
          mode: "similarity",
          a,
          b,
          translateX: targetCx - (a * sourceCx - b * sourceCy),
          translateY: targetCy - (b * sourceCx + a * sourceCy),
        };
      };
      const computeWeightedRmse = (referencePoints, projectedPoints) => {
        const alignment = computeSimilarityTransform(referencePoints, projectedPoints, anchors);
        const pointFor = (name) => {
          const point = projectedPoints[name];
          if (!point || alignment.mode !== "similarity") return point;
          return {
            ...point,
            x: alignment.a * point.x - alignment.b * point.y + alignment.translateX,
            y: alignment.b * point.x + alignment.a * point.y + alignment.translateY,
          };
        };
        let weightedSum = 0;
        let totalWeight = 0;
        const errors = {};
        for (const name of scoreLandmarks) {
          const target = referencePoints[name];
          const observed = pointFor(name);
          if (!target || !observed) continue;
          const emphasis = name === "right_wrist" ? 2.4 : name === "right_elbow" ? 1.8 : name === "left_wrist" ? 2.0 : 1.0;
          const weight = Number(target.weight ?? 1) * emphasis;
          const dx = Number(observed.x) - Number(target.x);
          const dy = Number(observed.y) - Number(target.y);
          const distance = Math.hypot(dx, dy);
          errors[name] = { dx, dy, distance, weight, target, projected: observed };
          weightedSum += distance * distance * weight;
          totalWeight += weight;
        }
        return {
          weightedRmse: totalWeight ? Math.sqrt(weightedSum / totalWeight) : Number.POSITIVE_INFINITY,
          errors,
          worst: Object.entries(errors)
            .map(([name, error]) => ({ name, ...error }))
            .sort((left, right) => right.distance * right.weight - left.distance * left.weight)
            .slice(0, 8),
        };
      };

      const runtime = window.__mmdCompanionRuntime;
      const model = runtime?.model;
      const camera = runtime?.camera;
      const canvas = runtime?.renderer?.domElement || document.querySelector("canvas");
      if (!runtime || !model || !camera || !canvas) throw new Error("MMD runtime is not ready");

      const bonesByName = new Map();
      const visit = (object) => {
        if (!object) return;
        for (const bone of object.skeleton?.bones || []) {
          if (bone?.name && !bonesByName.has(bone.name)) bonesByName.set(bone.name, bone);
        }
        if (object.name && object.isBone && !bonesByName.has(object.name)) bonesByName.set(object.name, object);
        for (const child of object.children || []) visit(child);
      };
      visit(model);

      const toObjectQuaternion = (values) => ({ x: Number(values[0]), y: Number(values[1]), z: Number(values[2]), w: Number(values[3]) });
      const base = {};
      for (const name of controlledBones) {
        const spec = seedFinal[name];
        if (spec) {
          base[name] = {
            quaternion: toObjectQuaternion(spec.quaternion),
            position: spec.position || [0, 0, 0],
          };
        } else {
          base[name] = { quaternion: { x: 0, y: 0, z: 0, w: 1 }, position: [0, 0, 0] };
        }
      }

      const multiplyMatrixVector = (matrix, vector) => {
        const e = matrix.elements;
        const [x, y, z, w] = vector;
        return [
          e[0] * x + e[4] * y + e[8] * z + e[12] * w,
          e[1] * x + e[5] * y + e[9] * z + e[13] * w,
          e[2] * x + e[6] * y + e[10] * z + e[14] * w,
          e[3] * x + e[7] * y + e[11] * z + e[15] * w,
        ];
      };
      const projectWorld = (world) => {
        const view = multiplyMatrixVector(camera.matrixWorldInverse, [world.x, world.y, world.z, 1]);
        const clip = multiplyMatrixVector(camera.projectionMatrix, view);
        const ndcX = clip[0] / clip[3];
        const ndcY = clip[1] / clip[3];
        const rect = canvas.getBoundingClientRect();
        return {
          x: ((ndcX + 1) / 2) * rect.width,
          y: ((1 - ndcY) / 2) * rect.height,
          z: clip[2] / clip[3],
        };
      };

      const buildQuaternion = (bone, deltas) => {
        let quaternion = base[bone]?.quaternion || { x: 0, y: 0, z: 0, w: 1 };
        for (const axis of ["x", "y", "z"]) {
          const degrees = Number(deltas[bone]?.[axis] || 0);
          if (Math.abs(degrees) > 1e-8) {
            quaternion = multiplyQuaternions(quaternion, axisAngleQuaternion(axis, degrees));
          }
        }
        return quaternion;
      };

      const applyPose = (deltas) => {
        for (const name of controlledBones) {
          const bone = bonesByName.get(name);
          if (!bone) continue;
          const quaternion = buildQuaternion(name, deltas);
          bone.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
          const position = base[name]?.position || [0, 0, 0];
          bone.position.set(Number(position[0]), Number(position[1]), Number(position[2]));
        }
        model.updateMatrixWorld?.(true);
        camera.updateMatrixWorld?.(true);
        camera.updateProjectionMatrix?.();
      };

      const measure = (deltas) => {
        applyPose(deltas);
        const projected = {};
        for (const request of requests) {
          const samples = [];
          for (const boneName of request.bones) {
            const bone = bonesByName.get(boneName);
            if (!bone) continue;
            bone.updateMatrixWorld?.(true);
            const elements = bone.matrixWorld.elements;
            const world = { x: elements[12], y: elements[13], z: elements[14] };
            samples.push(projectWorld(world));
          }
          if (!samples.length) continue;
          projected[request.name] = {
            x: samples.reduce((sum, point) => sum + point.x, 0) / samples.length,
            y: samples.reduce((sum, point) => sum + point.y, 0) / samples.length,
            z: samples.reduce((sum, point) => sum + point.z, 0) / samples.length,
          };
        }
        return { projected, report: computeWeightedRmse(reference, projected) };
      };

      const specs = parameterSpecs;

      const deltas = {};
      const getDelta = (bone, axis) => Number(deltas[bone]?.[axis] || 0);
      const setDelta = (bone, axis, value) => {
        deltas[bone] = deltas[bone] || {};
        deltas[bone][axis] = value;
      };
      const cloneDeltas = () => JSON.parse(JSON.stringify(deltas));

      let best = measure(deltas);
      const history = [{ pass: 0, step: 0, score: best.report.weightedRmse, deltas: cloneDeltas(), worst: best.report.worst }];
      for (let pass = 0; pass < passes; pass += 1) {
        const step = Number(initialStep) / 2 ** pass;
        let changed = false;
        for (const spec of specs) {
          const current = getDelta(spec.bone, spec.axis);
          const candidates = [
            { value: current, measured: best },
            { value: Math.max(spec.min, current - step) },
            { value: Math.min(spec.max, current + step) },
          ];
          for (const candidate of candidates) {
            if (!candidate.measured) {
              setDelta(spec.bone, spec.axis, candidate.value);
              candidate.measured = measure(deltas);
            }
          }
          candidates.sort((left, right) => left.measured.report.weightedRmse - right.measured.report.weightedRmse);
          setDelta(spec.bone, spec.axis, candidates[0].value);
          if (candidates[0].measured.report.weightedRmse < best.report.weightedRmse - 1e-6) {
            best = candidates[0].measured;
            changed = true;
          }
        }
        history.push({ pass: pass + 1, step, score: best.report.weightedRmse, deltas: cloneDeltas(), worst: best.report.worst });
        if (!changed && step <= 5) break;
      }

      applyPose(deltas);
      const final = {};
      for (const name of controlledBones) {
        const quaternion = buildQuaternion(name, deltas);
        final[name] = {
          quaternion: [quaternion.x, quaternion.y, quaternion.z, quaternion.w],
          position: base[name]?.position || [0, 0, 0],
        };
      }
      return {
        report: best.report,
        projected: best.projected,
        deltas,
        history,
        final,
        optimizedBones,
      };
    },
    {
      reference,
      requests,
      seedFinal,
      controlledBones: CONTROLLED_BONES,
      optimizedBones: OPTIMIZED_BONES,
      parameterSpecs: buildParameterSpecs({ scope }),
      passes,
      initialStep,
      scoreLandmarks: DEFAULT_SCORE_LANDMARKS,
      anchors: DEFAULT_ALIGNMENT_ANCHORS,
    },
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const modelPath = resolveWithinProject(options.model);
  const referencePath = resolveWithinProject(options.reference);
  const startVmdPath = resolveWithinProject(options.startVmd);
  const outputPath = resolveWithinProject(options.out);
  const reportPath = resolveWithinProject(options.report || path.join(path.dirname(options.out), "optimization_report.json"));
  if (!existsSync(modelPath)) throw new Error(`Model not found: ${modelPath}`);
  if (!existsSync(referencePath)) throw new Error(`Reference not found: ${referencePath}`);
  if (!existsSync(startVmdPath)) throw new Error(`Start VMD not found: ${startVmdPath}`);

  const referenceConfig = JSON.parse(readFileSync(referencePath, "utf8"));
  const reference = referenceLandmarks(referenceConfig, options.frameKey);
  const requests = landmarkRequests(referenceConfig);
  const staticServer = await startStaticServer(projectRoot);
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless: options.headless });
  const page = await browser.newPage({
    viewport: { width: options.viewportWidth, height: options.viewportHeight },
    deviceScaleFactor: 1,
  });

  try {
    const renderUrl = new URL("/mmd-calibration-render", options.webUrl);
    renderUrl.searchParams.set("modelUrl", toServedUrl(staticServer.baseUrl, modelPath));
    renderUrl.searchParams.set("renderPipeline", options.renderPipeline);
    await page.goto(renderUrl.href, { waitUntil: "domcontentloaded" });
    await waitForRuntime(page);
    await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));

    const seed = await captureSeedPose(page, {
      startVmdUrl: toServedUrl(staticServer.baseUrl, startVmdPath),
      startPrepFrame: options.startPrepFrame,
      startFrame: options.startFrame,
      fps: options.fps,
      bones: CONTROLLED_BONES,
    });
    const result = await optimizeInPage(page, {
      reference,
      requests,
      seedFinal: seed.final,
      passes: options.passes,
      initialStep: options.initialStep,
      scope: options.scope,
    });
    const directPose = poseFromQuaternions({
      prep: compactPoseBones(seed.prep),
      final: compactPoseBones(result.final),
      frameKey: options.frameKey,
      source: {
        start_vmd: path.relative(projectRoot, startVmdPath).replaceAll(path.sep, "/"),
        start_frame: options.startFrame,
        optimizer: "optimize-direct-pose.mjs",
      },
      report: {
        weighted_rmse: round(result.report.weightedRmse, 3),
        worst: result.report.worst.map((item) => ({
          name: item.name,
          distance: round(item.distance, 3),
          weight: round(item.weight, 3),
          dx: round(item.dx, 3),
          dy: round(item.dy, 3),
        })),
      },
    });

    mkdirSync(path.dirname(outputPath), { recursive: true });
    mkdirSync(path.dirname(reportPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(directPose, null, 2)}\n`, "utf8");
    writeFileSync(
      reportPath,
      `${JSON.stringify(
        {
          createdAt: new Date().toISOString(),
          frameKey: options.frameKey,
          startVmd: path.relative(projectRoot, startVmdPath).replaceAll(path.sep, "/"),
          startFrame: options.startFrame,
          weightedRmse: result.report.weightedRmse,
          worst: result.report.worst,
          deltas: result.deltas,
          history: result.history,
          projected: result.projected,
          directPose: path.relative(projectRoot, outputPath).replaceAll(path.sep, "/"),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
    console.log(
      `Wrote optimized direct pose to ${path.relative(projectRoot, outputPath)} ` +
        `(weighted_rmse=${result.report.weightedRmse.toFixed(3)})`,
    );
  } finally {
    await page.close();
    await browser.close();
    staticServer.server.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  });
}

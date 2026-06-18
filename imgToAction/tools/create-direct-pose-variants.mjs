#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const BONE_ID_PARTS = new Map([
  ["\u30bb\u30f3\u30bf\u30fc", "center"],
  ["\u4e0b\u534a\u8eab", "lower"],
  ["\u4e0a\u534a\u8eab", "upper"],
  ["\u4e0a\u534a\u8eab2", "upper2"],
  ["\u9996", "neck"],
  ["\u982d", "head"],
  ["\u5de6\u80a9", "Lshoulder"],
  ["\u5de6\u8155", "Larm"],
  ["\u5de6\u3072\u3058", "Lelbow"],
  ["\u5de6\u624b\u9996", "Lwrist"],
  ["\u53f3\u80a9", "Rshoulder"],
  ["\u53f3\u8155", "Rarm"],
  ["\u53f3\u3072\u3058", "Relbow"],
  ["\u53f3\u624b\u9996", "Rwrist"],
]);

function normalizeQuaternion(quaternion) {
  const values = quaternion.map((value) => Number(value));
  const length = Math.hypot(values[0], values[1], values[2], values[3]);
  if (length <= 1e-8) return [0, 0, 0, 1];
  return values.map((value) => value / length);
}

function axisAngleQuaternion(axis, degrees) {
  const radians = (Number(degrees) * Math.PI) / 180;
  const half = radians * 0.5;
  const value = Math.sin(half);
  if (axis === "x") return normalizeQuaternion([value, 0, 0, Math.cos(half)]);
  if (axis === "y") return normalizeQuaternion([0, value, 0, Math.cos(half)]);
  if (axis === "z") return normalizeQuaternion([0, 0, value, Math.cos(half)]);
  throw new Error(`Unknown axis: ${axis}`);
}

function multiplyQuaternions(left, right) {
  const [ax, ay, az, aw] = left;
  const [bx, by, bz, bw] = right;
  return normalizeQuaternion([
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]);
}

function roundQuaternion(quaternion) {
  return quaternion.map((value) => Number(value.toFixed(8)));
}

export function applyBoneDeltas(pose, { deltas, frames = [0, 30, 60, 90] }) {
  const next = JSON.parse(JSON.stringify(pose));
  const frameSet = new Set(frames.map((frame) => Number(frame)));
  for (const keyframe of next.keyframes || []) {
    if (!frameSet.has(Number(keyframe.frame))) continue;
    for (const [boneName, axes] of Object.entries(deltas || {})) {
      const bone = keyframe.bones?.[boneName];
      if (!bone) throw new Error(`Missing bone ${boneName} at frame ${keyframe.frame}`);
      let quaternion = normalizeQuaternion(bone.quaternion || [0, 0, 0, 1]);
      for (const [axis, degrees] of Object.entries(axes || {})) {
        if (Math.abs(Number(degrees)) <= 1e-8) continue;
        quaternion = multiplyQuaternions(quaternion, axisAngleQuaternion(axis, Number(degrees)));
      }
      bone.quaternion = roundQuaternion(quaternion);
    }
  }
  return next;
}

function signedPart(value) {
  const numeric = Number(value);
  const prefix = numeric < 0 ? "m" : "p";
  return `${prefix}${String(Math.abs(numeric)).replaceAll(".", "p")}`;
}

export function safeVariantId(deltas) {
  const parts = [];
  const boneOrder = new Map([...BONE_ID_PARTS.keys()].map((boneName, index) => [boneName, index]));
  const orderedBones = Object.keys(deltas || {}).sort((left, right) => {
    const leftOrder = boneOrder.has(left) ? boneOrder.get(left) : Number.MAX_SAFE_INTEGER;
    const rightOrder = boneOrder.has(right) ? boneOrder.get(right) : Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder || left.localeCompare(right);
  });
  for (const boneName of orderedBones) {
    const bonePart = BONE_ID_PARTS.get(boneName) || boneName.replace(/[^\w.-]+/g, "_");
    for (const axis of Object.keys(deltas[boneName] || {}).sort()) {
      parts.push(`${bonePart}_${axis}_${signedPart(deltas[boneName][axis])}`);
    }
  }
  return parts.join("_") || "identity";
}

function splitList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFrames(value) {
  return splitList(value).map((item) => {
    const frame = Number.parseInt(item, 10);
    if (!Number.isFinite(frame) || String(frame) !== item || frame < 0) throw new Error(`Invalid frame: ${item}`);
    return frame;
  });
}

function parseDelta(value) {
  const [boneName, axis, degrees] = String(value || "").split(":");
  if (!boneName || !axis || degrees === undefined) throw new Error(`Invalid delta: ${value}`);
  if (!["x", "y", "z"].includes(axis)) throw new Error(`Invalid delta axis: ${axis}`);
  const numeric = Number(degrees);
  if (!Number.isFinite(numeric)) throw new Error(`Invalid delta degrees: ${degrees}`);
  return { boneName, axis, degrees: numeric };
}

function addDelta(deltas, { boneName, axis, degrees }) {
  deltas[boneName] = deltas[boneName] || {};
  deltas[boneName][axis] = Number(deltas[boneName][axis] || 0) + Number(degrees);
}

function resolveWithinProject(filePath) {
  const resolved = path.isAbsolute(filePath) ? path.resolve(filePath) : path.resolve(projectRoot, filePath);
  if (resolved !== projectRoot && !resolved.startsWith(`${projectRoot}${path.sep}`)) {
    throw new Error(`Path is outside project root: ${filePath}`);
  }
  return resolved;
}

function parseArgs(argv) {
  const options = {
    base: "",
    outDir: "",
    frames: [0, 30, 60, 90],
    motionPrefix: "variant",
    id: "",
    deltas: [],
    sweepBones: [],
    sweepAxes: [],
    sweepDegrees: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--base") {
      options.base = next;
      index += 1;
    } else if (arg === "--out-dir") {
      options.outDir = next;
      index += 1;
    } else if (arg === "--frames") {
      options.frames = parseFrames(next);
      index += 1;
    } else if (arg === "--motion-prefix") {
      options.motionPrefix = next;
      index += 1;
    } else if (arg === "--id") {
      options.id = next;
      index += 1;
    } else if (arg === "--delta") {
      options.deltas.push(parseDelta(next));
      index += 1;
    } else if (arg === "--sweep-bones") {
      options.sweepBones = splitList(next);
      index += 1;
    } else if (arg === "--sweep-axes") {
      options.sweepAxes = splitList(next);
      index += 1;
    } else if (arg === "--sweep-degrees") {
      options.sweepDegrees = splitList(next).map(Number);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node imgToAction/tools/create-direct-pose-variants.mjs --base POSE --out-dir DIR [options]

Options:
  --delta BONE:AXIS:DEGREES     Add one local-axis rotation. Repeatable.
  --id NAME                     Variant id for --delta mode.
  --sweep-bones LIST            Comma list of bones for single-axis sweeps.
  --sweep-axes LIST             Comma list of axes. Example: x,y,z
  --sweep-degrees LIST          Comma list of degrees. Example: -30,-15,15,30
  --frames LIST                 Keyframes to edit. Default: 0,30,60,90
  --motion-prefix NAME          Motion name prefix. Default: variant
`);
}

function buildVariants(options) {
  if (options.deltas.length) {
    const deltas = {};
    for (const delta of options.deltas) addDelta(deltas, delta);
    return [{ id: options.id || safeVariantId(deltas), deltas }];
  }

  if (!options.sweepBones.length || !options.sweepAxes.length || !options.sweepDegrees.length) {
    throw new Error("Either --delta or all sweep options are required");
  }

  const variants = [];
  for (const boneName of options.sweepBones) {
    for (const axis of options.sweepAxes) {
      if (!["x", "y", "z"].includes(axis)) throw new Error(`Invalid sweep axis: ${axis}`);
      for (const degrees of options.sweepDegrees) {
        if (!Number.isFinite(degrees)) throw new Error(`Invalid sweep degrees for ${boneName}:${axis}`);
        const deltas = { [boneName]: { [axis]: degrees } };
        variants.push({ id: safeVariantId(deltas), deltas });
      }
    }
  }
  return variants;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.base) throw new Error("--base is required");
  if (!options.outDir) throw new Error("--out-dir is required");

  const basePath = resolveWithinProject(options.base);
  const outDir = resolveWithinProject(options.outDir);
  if (!existsSync(basePath)) throw new Error(`Base pose not found: ${basePath}`);

  const basePose = JSON.parse(readFileSync(basePath, "utf8"));
  const variants = buildVariants(options);
  mkdirSync(outDir, { recursive: true });

  const manifest = [];
  for (const variant of variants) {
    const pose = applyBoneDeltas(basePose, { deltas: variant.deltas, frames: options.frames });
    pose.motion_name = `${options.motionPrefix}_${variant.id}`;
    pose.source = {
      ...(pose.source || {}),
      variant_base: path.relative(projectRoot, basePath).replaceAll(path.sep, "/"),
      variant_deltas: variant.deltas,
      variant_frames: options.frames,
    };

    const variantDir = path.join(outDir, variant.id);
    mkdirSync(variantDir, { recursive: true });
    const directPosePath = path.join(variantDir, "direct_pose.json");
    writeFileSync(directPosePath, `${JSON.stringify(pose, null, 2)}\n`, "utf8");
    manifest.push({
      id: variant.id,
      deltas: variant.deltas,
      directPose: path.relative(projectRoot, directPosePath).replaceAll(path.sep, "/"),
    });
  }

  const manifestPath = path.join(outDir, "manifest.json");
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${manifest.length} variants to ${path.relative(projectRoot, outDir)}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}

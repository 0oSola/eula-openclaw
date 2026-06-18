#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");

const MIME_TYPES = {
  ".bmp": "image/bmp",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".pmx": "application/octet-stream",
  ".tga": "application/octet-stream",
  ".vmd": "application/octet-stream",
};

export function buildLandmarkRequests(referenceConfig) {
  return Object.entries(referenceConfig?.model_landmark_map || {}).map(([name, bones]) => ({
    name,
    bones: Array.isArray(bones) ? bones : [String(bones)],
  }));
}

function parseArgs(argv) {
  const options = {
    reference: "imgToAction/config/reference_landmarks.eula_signature.json",
    frameKey: "frame_60_front",
    frame: 60,
    fps: 30,
    webUrl: "http://127.0.0.1:3100",
    renderPipeline: "hero-shot",
    viewportWidth: 1024,
    viewportHeight: 1536,
    model: "",
    vmd: "imgToAction/outputs/vmd/eula_signature_from_axis_map.vmd",
    out: "imgToAction/outputs/fitting/eula_signature_from_axis_map/model_landmarks.frame_060_front.json",
    headless: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--reference") {
      options.reference = next;
      index += 1;
    } else if (arg === "--frame-key") {
      options.frameKey = next;
      index += 1;
    } else if (arg === "--frame") {
      options.frame = Number.parseInt(next, 10) || options.frame;
      index += 1;
    } else if (arg === "--fps") {
      options.fps = Number(next) || options.fps;
      index += 1;
    } else if (arg === "--web-url") {
      options.webUrl = next;
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
    } else if (arg === "--model") {
      options.model = next;
      index += 1;
    } else if (arg === "--vmd") {
      options.vmd = next;
      index += 1;
    } else if (arg === "--out") {
      options.out = next;
      index += 1;
    } else if (arg === "--headful") {
      options.headless = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function resolveWithinProject(filePath) {
  const resolved = path.resolve(projectRoot, filePath);
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
      response.end(String(error));
    }
  });

  return new Promise((resolve) => {
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

function defaultModelPath() {
  const calibrationManifest = resolveWithinProject("imgToAction/outputs/axis-calibration-full-target-20260615-direct-sample/manifest.json");
  if (existsSync(calibrationManifest)) {
    return JSON.parse(readFileSync(calibrationManifest, "utf8")).model;
  }
  const mainModel = "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx";
  return existsSync(resolveWithinProject(mainModel)) ? mainModel : "imgToAction/assets/pmx/优菈.pmx";
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const referencePath = resolveWithinProject(options.reference);
  const referenceConfig = JSON.parse(readFileSync(referencePath, "utf8"));
  const requests = buildLandmarkRequests(referenceConfig);
  const modelPath = resolveWithinProject(options.model || defaultModelPath());
  const vmdPath = resolveWithinProject(options.vmd);
  const outputPath = resolveWithinProject(options.out);

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

    const vmdUrl = toServedUrl(staticServer.baseUrl, vmdPath);
    const played = await page.evaluate(async (url) => {
      const runtime = window.__mmdCompanionRuntime;
      runtime?.setCalibrationCaptureMode?.(true);
      const result = await runtime?.playVmd?.(url, 1, [], { disableCrossfade: true });
      runtime?.setCalibrationCaptureMode?.(true);
      return result !== false;
    }, vmdUrl);
    if (!played) throw new Error(`Failed to load VMD: ${options.vmd}`);

    const ok = await page.evaluate(
      ({ frame, fps }) => window.__mmdCompanionRuntime?.seekVmdFrame?.(frame, fps) === true,
      { frame: options.frame, fps: options.fps },
    );
    if (!ok) throw new Error(`Failed to seek frame ${options.frame}`);

    const payload = await page.evaluate(({ requests, frame, frameKey, source }) => {
      const runtime = window.__mmdCompanionRuntime;
      const camera = runtime?.camera;
      const model = runtime?.model;
      const canvas = runtime?.renderer?.domElement || document.querySelector("canvas");
      if (!runtime || !camera || !model || !canvas) {
        throw new Error("MMD runtime is missing model, camera, or canvas");
      }

      model.updateMatrixWorld?.(true);
      camera.updateMatrixWorld?.(true);
      camera.updateProjectionMatrix?.();

      const bonesByName = new Map();
      const visit = (object) => {
        if (!object) return;
        const skeletonBones = object.skeleton?.bones || [];
        for (const bone of skeletonBones) {
          if (bone?.name && !bonesByName.has(bone.name)) bonesByName.set(bone.name, bone);
        }
        if (object.name && object.isBone && !bonesByName.has(object.name)) bonesByName.set(object.name, object);
        for (const child of object.children || []) visit(child);
      };
      visit(model);

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
          ndc: { x: ndcX, y: ndcY, z: clip[2] / clip[3] },
        };
      };

      const landmarks = {};
      for (const request of requests) {
        const points = [];
        const usedBones = [];
        for (const boneName of request.bones) {
          const bone = bonesByName.get(boneName);
          if (!bone) continue;
          bone.updateMatrixWorld?.(true);
          const elements = bone.matrixWorld.elements;
          const world = { x: elements[12], y: elements[13], z: elements[14] };
          const projected = projectWorld(world);
          points.push({ ...projected, world, bone: boneName });
          usedBones.push(boneName);
        }
        if (!points.length) continue;
        landmarks[request.name] = {
          x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
          y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
          bones: usedBones,
          samples: points,
        };
      }

      const rect = canvas.getBoundingClientRect();
      return {
        source,
        frame,
        frame_key: frameKey,
        image_width: rect.width,
        image_height: rect.height,
        landmarks,
      };
    }, {
      requests,
      frame: options.frame,
      frameKey: options.frameKey,
      source: options.vmd,
    });

    mkdirSync(path.dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    console.log(`Wrote ${Object.keys(payload.landmarks).length} projected landmarks to ${path.relative(projectRoot, outputPath)}`);
  } finally {
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

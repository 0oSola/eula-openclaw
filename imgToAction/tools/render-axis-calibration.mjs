#!/usr/bin/env node
import { createServer } from "node:http";
import { createReadStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildAxisCalibrationCapturePlan } from "./axis-calibration-plan.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "../..");
const DEFAULT_MODEL_PATH = existsSync(path.resolve(projectRoot, "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"))
  ? "MMD/优菈_by_原神_339146e6e418d79e85a515b26414c0b0/优菈.pmx"
  : "imgToAction/assets/pmx/优菈.pmx";

const DEFAULT_SCHEDULES = {
  upper_body: {
    group: "upper_body",
    vmdPath: "imgToAction/calibration/upper_body/eula_axis_calibration_upper_body.vmd",
    csvPath: "imgToAction/calibration/upper_body/eula_axis_calibration_upper_body_schedule.csv",
  },
  lower_body: {
    group: "lower_body",
    vmdPath: "imgToAction/calibration/lower_body/eula_axis_calibration_lower_body_rotation.vmd",
    csvPath: "imgToAction/calibration/lower_body/eula_axis_calibration_lower_body_rotation_schedule.csv",
  },
  ik_center: {
    group: "ik_center",
    vmdPath: "imgToAction/calibration/ik_center/eula_axis_calibration_ik_center_position.vmd",
    csvPath: "imgToAction/calibration/ik_center/eula_axis_calibration_ik_center_position_schedule.csv",
  },
};

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".csv": "text/csv; charset=utf-8",
  ".png": "image/png",
  ".pmx": "application/octet-stream",
  ".pmd": "application/octet-stream",
  ".vmd": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".tga": "application/octet-stream",
  ".bmp": "image/bmp",
};

function parseArgs(argv) {
  const options = {
    webUrl: "http://127.0.0.1:3100",
    model: DEFAULT_MODEL_PATH,
    out: "imgToAction/outputs/axis-calibration-renders",
    groups: ["upper_body", "lower_body", "ik_center"],
    frames: ["target", "hold"],
    renderPipeline: "hero-shot",
    fps: 30,
    viewportWidth: 1024,
    viewportHeight: 1536,
    headless: true,
    limit: 0,
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
    } else if (arg === "--out") {
      options.out = next;
      index += 1;
    } else if (arg === "--groups") {
      options.groups = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--frames") {
      options.frames = next.split(",").map((item) => item.trim()).filter(Boolean);
      index += 1;
    } else if (arg === "--render-pipeline") {
      options.renderPipeline = next;
      index += 1;
    } else if (arg === "--fps") {
      options.fps = Number(next) || 30;
      index += 1;
    } else if (arg === "--viewport") {
      const [width, height] = next.split("x").map((value) => Number.parseInt(value, 10));
      if (Number.isFinite(width) && Number.isFinite(height)) {
        options.viewportWidth = width;
        options.viewportHeight = height;
      }
      index += 1;
    } else if (arg === "--headful") {
      options.headless = false;
    } else if (arg === "--limit") {
      options.limit = Number.parseInt(next, 10) || 0;
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  node imgToAction/tools/render-axis-calibration.mjs [options]

Options:
  --web-url URL              Next dev server URL. Default: http://127.0.0.1:3100
  --model PATH               PMX path under repo root. Default: ${DEFAULT_MODEL_PATH}
  --out PATH                 Output directory. Default: imgToAction/outputs/axis-calibration-renders
  --groups LIST              Comma list: upper_body,lower_body,ik_center
  --frames LIST              Comma list: target,hold,start,reset
  --render-pipeline NAME     MMD render pipeline. Default: hero-shot
  --fps N                    VMD FPS used for seek. Default: 30
  --viewport WxH             Browser viewport. Default: 1024x1536
  --limit N                  Capture only first N frames, useful for smoke tests
  --headful                  Show Chromium
`);
}

function resolveWithinProject(relativeOrAbsolutePath) {
  return path.resolve(projectRoot, relativeOrAbsolutePath);
}

function toServedUrl(baseUrl, filePath) {
  const absolutePath = path.resolve(filePath);
  const relativePath = path.relative(projectRoot, absolutePath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Path is outside project root: ${filePath}`);
  }
  return `${baseUrl}/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
}

function startStaticServer(rootDir) {
  const root = path.resolve(rootDir);
  const server = createServer((request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const decodedPath = decodeURIComponent(requestUrl.pathname.replace(/^\/+/, ""));
      const target = path.resolve(root, decodedPath);
      if ((target !== root && !target.startsWith(`${root}${path.sep}`)) || !existsSync(target)) {
        response.writeHead(404, { "Access-Control-Allow-Origin": "*" });
        response.end("Not found");
        return;
      }
      const extension = path.extname(target).toLowerCase();
      response.writeHead(200, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
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
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
      });
    });
  });
}

function loadSchedules(groups) {
  return groups.map((group) => {
    const schedule = DEFAULT_SCHEDULES[group];
    if (!schedule) throw new Error(`Unknown calibration group: ${group}`);
    return {
      group: schedule.group,
      vmdPath: schedule.vmdPath,
      csvText: readFileSync(resolveWithinProject(schedule.csvPath), "utf8"),
    };
  });
}

function writeManifest(outputDir, payload) {
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(path.join(outputDir, "manifest.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeContactSheet(outputDir, manifest) {
  const imageItems = manifest.captures
    .map(
      (capture) => `<figure>
  <img src="${capture.outputPath.replaceAll("\\", "/")}" alt="${capture.group} ${capture.bone} ${capture.axis}${capture.sign} ${capture.frameKind}" loading="lazy">
  <figcaption>${capture.group} · #${capture.testNo} · ${capture.bone} · ${capture.axis}${capture.sign} · ${capture.frameKind} f${capture.frame}</figcaption>
</figure>`,
    )
    .join("\n");
  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>MMD Axis Calibration Contact Sheet</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #111; color: #eee; }
    header { position: sticky; top: 0; z-index: 1; padding: 12px 16px; background: #191919; border-bottom: 1px solid #333; }
    main { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; padding: 12px; }
    figure { margin: 0; background: #1d1d1d; border: 1px solid #333; }
    img { display: block; width: 100%; height: auto; background: #000; }
    figcaption { padding: 8px; font-size: 12px; line-height: 1.35; }
  </style>
</head>
<body>
  <header>
    <strong>MMD Axis Calibration Contact Sheet</strong>
    <span>${manifest.captures.length} captures · ${manifest.createdAt}</span>
  </header>
  <main>${imageItems}</main>
</body>
</html>
`;
  writeFileSync(path.join(outputDir, "contact-sheet.html"), html, "utf8");
}

function isBenignBrowserConsoleMessage(text) {
  return (
    /THREE\.Material: '(skinning|morphTargets|envMap|combine)' is not a property/i.test(text) ||
    /GPU stall due to ReadPixels/i.test(text) ||
    /Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED/i.test(text)
  );
}

async function importPlaywright() {
  const requireFromWeb = createRequire(path.join(projectRoot, "web", "package.json"));
  try {
    return requireFromWeb("playwright");
  } catch (error) {
    const packageUrl = pathToFileURL(path.join(projectRoot, "web", "node_modules", "@playwright", "test", "index.js"));
    try {
      const testPackage = await import(packageUrl.href);
      return testPackage;
    } catch {
      throw error;
    }
  }
}

async function waitForRuntime(page) {
  try {
    await page.waitForFunction(
      () => Boolean(window.__mmdCompanionRuntime?.model && !window.__mmdCompanionRuntime?.isLoadingVmd),
      null,
      { timeout: 60_000 },
    );
  } catch (error) {
    const diagnostics = await page.evaluate(() => {
      const runtime = window.__mmdCompanionRuntime;
      const status = document.querySelector(".mio-stage-status")?.textContent || "";
      return {
        href: window.location.href,
        hasRuntime: Boolean(runtime),
        hasModel: Boolean(runtime?.model),
        isLoadingVmd: Boolean(runtime?.isLoadingVmd),
        currentVmdUrl: runtime?.currentVmdUrl || "",
        status,
      };
    });
    throw new Error(`MMD runtime did not become ready: ${JSON.stringify(diagnostics)}`, { cause: error });
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const modelPath = resolveWithinProject(options.model);
  if (!existsSync(modelPath)) {
    throw new Error(`Model not found: ${modelPath}`);
  }

  const schedules = loadSchedules(options.groups);
  const plan = buildAxisCalibrationCapturePlan({ schedules, frameKinds: options.frames });
  const outputDir = resolveWithinProject(options.out);
  mkdirSync(outputDir, { recursive: true });

  const staticServer = await startStaticServer(projectRoot);
  const { chromium } = await importPlaywright();
  const browser = await chromium.launch({ headless: options.headless });
  const page = await browser.newPage({
    viewport: { width: options.viewportWidth, height: options.viewportHeight },
    deviceScaleFactor: 1,
  });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      const text = message.text();
      if (!isBenignBrowserConsoleMessage(text)) {
        consoleErrors.push(`[${message.type()}] ${text}`);
      }
    }
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(`[pageerror] ${error.message}`);
  });

  const captures = [];
  try {
    const modelUrl = toServedUrl(staticServer.baseUrl, modelPath);
    const renderUrl = new URL("/mmd-calibration-render", options.webUrl);
    renderUrl.searchParams.set("modelUrl", modelUrl);
    renderUrl.searchParams.set("renderPipeline", options.renderPipeline);

    await page.goto(renderUrl.href, { waitUntil: "domcontentloaded" });
    await waitForRuntime(page);
    await page.evaluate(() => window.__mmdCompanionRuntime?.setCalibrationCaptureMode?.(true));

    let remaining = options.limit > 0 ? options.limit : Number.POSITIVE_INFINITY;
    for (const step of plan.steps) {
      if (remaining <= 0) break;
      const vmdUrl = toServedUrl(staticServer.baseUrl, resolveWithinProject(step.vmdPath));
      const played = await page.evaluate(async (url) => {
        const runtime = window.__mmdCompanionRuntime;
        runtime?.setCalibrationCaptureMode?.(true);
        const result = await runtime?.playVmd?.(url, 1, [], { disableCrossfade: true });
        runtime?.setCalibrationCaptureMode?.(true);
        return result !== false;
      }, vmdUrl);
      if (!played) throw new Error(`Failed to load VMD: ${step.vmdPath}`);

      for (const capture of step.captures) {
        if (remaining <= 0) break;
        const ok = await page.evaluate(
          ({ frame, fps }) => window.__mmdCompanionRuntime?.seekVmdFrame?.(frame, fps) === true,
          { frame: capture.frame, fps: options.fps },
        );
        if (!ok) throw new Error(`Failed to seek frame ${capture.frame} for ${step.vmdPath}`);

        const outputPath = path.join(outputDir, capture.outputPath);
        mkdirSync(path.dirname(outputPath), { recursive: true });
        await page.locator("canvas").first().screenshot({ path: outputPath });
        captures.push({
          ...capture,
          vmdPath: step.vmdPath,
          outputPath: capture.outputPath.replaceAll("\\", "/"),
        });
        remaining -= 1;
        console.log(`captured ${capture.outputPath}`);
      }
    }
  } finally {
    await browser.close();
    staticServer.server.close();
  }

  if (consoleErrors.length) {
    console.warn(consoleErrors.join("\n"));
  }

  const manifest = {
    createdAt: new Date().toISOString(),
    webUrl: options.webUrl,
    model: options.model,
    renderPipeline: options.renderPipeline,
    fps: options.fps,
    captures,
  };
  writeManifest(outputDir, manifest);
  writeContactSheet(outputDir, manifest);
  console.log(`Wrote ${captures.length} captures to ${path.relative(projectRoot, outputDir)}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exitCode = 1;
});

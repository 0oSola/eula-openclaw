import { chromium } from "../web/node_modules/playwright/index.mjs";
import sharp from "../web/node_modules/sharp/lib/index.js";
import fs from "node:fs/promises";
import path from "node:path";

const DEFAULT_OUTPUT = path.resolve("D:/workspace/MMD project/.artifacts/companion-latest.png");
const DEFAULT_URL = "http://127.0.0.1:3100/companion";
const DEFAULT_VIEWPORT = "1536x1024";
const MIN_MODEL_BYTES = 1024 * 100;
const MIN_STAGE_VISIBLE_RATIO = 0.018;

const outputPath = path.resolve(process.argv[2] || DEFAULT_OUTPUT);
const url = process.argv[3] || DEFAULT_URL;
const viewportArg = process.argv[4] || DEFAULT_VIEWPORT;
const scenario = (process.argv[5] || "main").toLowerCase();
const preferredModelPath = process.argv[6] || "";
const [viewportWidth, viewportHeight] = viewportArg.split(/[xX]/).map((value) => Number.parseInt(value, 10));
const pageUrl = new URL(url);
const apiBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || `${pageUrl.protocol}//${pageUrl.hostname}:8100`;

function requireViewportSize(value, fallback) {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

async function fetchJson(fetchUrl) {
  const response = await fetch(fetchUrl);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status} ${response.statusText} ${fetchUrl}`);
  }
  return response.json();
}

async function chooseRenderableModel() {
  const payload = await fetchJson(`${apiBaseUrl}/assets/mmd/models`);
  const models = Array.isArray(payload.items) ? payload.items : [];
  if (!models.length) {
    throw new Error(`No MMD models found from ${apiBaseUrl}/assets/mmd/models`);
  }

  if (preferredModelPath) {
    const preferred = models.find((model) => model.relative_path === preferredModelPath);
    if (!preferred) {
      throw new Error(`Preferred MMD model not found: ${preferredModelPath}`);
    }
    return preferred;
  }

  const renderable = models
    .filter((model) => Number(model.size_bytes) >= MIN_MODEL_BYTES)
    .sort((left, right) => Number(right.size_bytes) - Number(left.size_bytes));
  if (!renderable.length) {
    const summary = models.map((model) => `${model.relative_path} (${model.size_bytes} bytes)`).join(", ");
    throw new Error(`No renderable MMD model candidates found. Models: ${summary}`);
  }
  return renderable[0];
}

async function waitForRenderableStage(page, selectedModel) {
  await page.getByTestId("mio-command-bar").waitFor({ state: "visible", timeout: 60000 });
  await page.getByTestId("mio-stage-wrap").locator("canvas").waitFor({ state: "visible", timeout: 120000 });

  await page.waitForFunction(
    ({ modelPath }) => {
      const runtime = window.__mmdCompanionRuntime;
      const canvas = document.querySelector('[data-testid="mio-stage-wrap"] canvas');
      const statusText =
        document.querySelector('[data-testid="mio-stage-wrap"] .mio-stage-status')?.textContent ||
        document.querySelector('[data-testid="mio-stage-wrap"] p')?.textContent ||
        "";
      const selectedOption = document.querySelector(
        '[data-testid="mio-advanced-stage"] select option:checked, [aria-label="Model"] option:checked',
      );
      const selectedText = selectedOption?.textContent || "";
      const runtimeModel = runtime?.model;
      const modelVisible =
        runtimeModel &&
        runtimeModel.visible !== false &&
        (!Array.isArray(runtimeModel.children) || runtimeModel.children.length > 0);
      const statusReady = /Model ready|Playing mapped VMD motion|VMD playback failed/i.test(statusText);
      const statusFailed = /No MMD models|Model load failed/i.test(statusText);
      const sizeReady =
        canvas &&
        canvas.clientWidth >= 240 &&
        canvas.clientHeight >= 240 &&
        canvas.width >= 240 &&
        canvas.height >= 240;
      return Boolean(
        modelVisible &&
          statusReady &&
          !statusFailed &&
          sizeReady &&
          (!modelPath || runtimeModel.name || selectedText),
      );
    },
    { modelPath: selectedModel.relative_path },
    { timeout: 120000, polling: 250 },
  );

  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
      }),
    null,
    { timeout: 5000 },
  );
}

async function waitForCompanionShell(page) {
  await page.getByTestId("mio-command-bar").waitFor({ state: "visible", timeout: 60000 });
  await page.getByTestId("mio-stage-wrap").waitFor({ state: "visible", timeout: 60000 });
}

async function switchToModelIfNeeded(page, model) {
  const advancedButton = page.locator('button[aria-controls="mio-advanced-panel"]').first();
  if ((await page.getByTestId("mio-advanced-panel").count()) === 0) {
    await advancedButton.click();
    await page.getByTestId("mio-advanced-panel").waitFor({ state: "visible", timeout: 10000 });
  }
  const modelSelect = page.getByTestId("mio-advanced-stage").locator("select");
  await modelSelect.waitFor({ state: "visible", timeout: 60000 });
  const current = await modelSelect.evaluate((select) => select.value).catch(() => "");
  if (current !== model.relative_path) {
    await modelSelect.selectOption(model.relative_path);
  }
  await waitForRenderableStage(page, model);
  if (scenario !== "advanced") {
    await advancedButton.click();
    await page.getByTestId("mio-advanced-panel").waitFor({ state: "detached", timeout: 10000 }).catch(() => {});
  }
}

async function prepareScenario(page, selectedModel) {
  await switchToModelIfNeeded(page, selectedModel);
  if (scenario === "advanced") {
    const advancedButton = page.locator('button[aria-controls="mio-advanced-panel"]').first();
    if ((await page.getByTestId("mio-advanced-panel").count()) === 0) {
      await advancedButton.click();
    }
    await page.getByTestId("mio-advanced-panel").waitFor({ state: "visible", timeout: 10000 });
    await waitForRenderableStage(page, selectedModel);
    return;
  }
  if (scenario !== "main") {
    throw new Error(`Unknown screenshot scenario: ${scenario}`);
  }
}

async function measureStagePixels(imagePath, stageBox) {
  const image = sharp(imagePath);
  const metadata = await image.metadata();
  const width = metadata.width || 0;
  const height = metadata.height || 0;
  if (!width || !height) throw new Error(`Screenshot has invalid dimensions: ${width}x${height}`);

  const left = Math.max(0, Math.floor(stageBox.x));
  const top = Math.max(0, Math.floor(stageBox.y));
  const cropWidth = Math.max(1, Math.min(width - left, Math.floor(stageBox.width)));
  const cropHeight = Math.max(1, Math.min(height - top, Math.floor(stageBox.height)));
  const { data, info } = await image
    .extract({ left, top, width: cropWidth, height: cropHeight })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  let samples = 0;
  let visible = 0;
  let bright = 0;
  const stride = Math.max(4, Math.floor((info.width * info.height * 4) / 200000) * 4);
  for (let index = 0; index < data.length; index += stride) {
    const red = data[index];
    const green = data[index + 1];
    const blue = data[index + 2];
    const alpha = data[index + 3];
    samples += 1;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const luminance = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    if (alpha > 16 && max - min > 10 && luminance > 24) visible += 1;
    if (alpha > 16 && luminance > 150) bright += 1;
  }

  const visibleRatio = samples ? visible / samples : 0;
  const brightRatio = samples ? bright / samples : 0;
  return {
    crop: { left, top, width: cropWidth, height: cropHeight },
    samples,
    visible,
    bright,
    visibleRatio,
    brightRatio,
  };
}

await fs.mkdir(path.dirname(outputPath), { recursive: true });
const selectedModel = await chooseRenderableModel();

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: {
    width: requireViewportSize(viewportWidth, 1536),
    height: requireViewportSize(viewportHeight, 1024),
  },
  deviceScaleFactor: 1,
});

try {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "mio-reference", ttsEnabled: true }),
    );
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await waitForCompanionShell(page);
  await prepareScenario(page, selectedModel);

  const stageBox = await page.getByTestId("mio-stage-wrap").boundingBox();
  if (!stageBox) throw new Error("Unable to locate MMD stage bounding box.");

  await page.screenshot({ path: outputPath, fullPage: true });
  const measurement = await measureStagePixels(outputPath, stageBox);
  if (measurement.visibleRatio < MIN_STAGE_VISIBLE_RATIO) {
    throw new Error(
      `MMD stage screenshot appears blank: visibleRatio=${measurement.visibleRatio.toFixed(4)} ` +
        `brightRatio=${measurement.brightRatio.toFixed(4)} crop=${JSON.stringify(measurement.crop)}`,
    );
  }

  console.log(
    JSON.stringify(
      {
        outputPath,
        url,
        scenario,
        model: selectedModel.relative_path,
        modelSizeBytes: selectedModel.size_bytes,
        stagePixels: measurement,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}

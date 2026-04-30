import { chromium } from "../web/node_modules/playwright/index.mjs";
import path from "node:path";

const outputPath =
  process.argv[2] || path.resolve("D:/workspace/MMD project/.artifacts/companion-latest.png");
const url = process.argv[3] || "http://127.0.0.1:3100/companion";
const viewportArg = process.argv[4] || "1536x1024";
const [viewportWidth, viewportHeight] = viewportArg.split(/[xX]/).map((value) => Number.parseInt(value, 10));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: viewportWidth || 1536, height: viewportHeight || 1024 },
  deviceScaleFactor: 1,
});

await page.addInitScript(() => {
  window.localStorage.setItem(
    "mmd_companion_session_v1",
    JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "classic" }),
  );
});
await page.goto(url, { waitUntil: "networkidle", timeout: 60000 });
await page.getByTestId("mio-command-bar").waitFor({ state: "visible", timeout: 60000 });
await page.screenshot({ path: outputPath, fullPage: true });
await browser.close();

console.log(outputPath);

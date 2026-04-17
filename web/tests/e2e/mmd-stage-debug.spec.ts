import { expect, test } from "@playwright/test";

test("companion stage loads model assets without MMD request failures @critical", async ({
  page,
}, testInfo) => {
  const consoleMessages: string[] = [];
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on("console", (msg) => {
    consoleMessages.push(`[${msg.type()}] ${msg.text()}`);
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("requestfailed", (request) => {
    const url = request.url();
    if (url.includes("/assets/mmd/")) {
      const failure = request.failure();
      failedRequests.push(`${request.method()} ${url} :: ${failure?.errorText || "request failed"}`);
    }
  });

  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("/assets/mmd/") && response.status() >= 400) {
      failedRequests.push(`${response.request().method()} ${url} :: HTTP ${response.status()}`);
    }
  });

  await page.addInitScript(() => {
    window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: "playwright-user" }));
  });

  await page.goto("/companion");

  const stageHeading = page.getByRole("heading", { name: "Companion Stage" });
  await expect(stageHeading).toBeVisible();

  const modelSelector = page.getByRole("combobox", { name: "Model" });
  await expect(modelSelector).toBeVisible();
  await expect(modelSelector.locator("option")).not.toHaveCount(0);
  await expect(modelSelector.locator("option:checked")).not.toContainText(/\.pm[dx]$/i);

  const status = page
    .locator("p")
    .filter({ hasText: /Initializing stage|Loading MMD model|Model ready|Model load failed/ })
    .last();
  await expect(status).toContainText(/Model ready|Model load failed/, { timeout: 30_000 });

  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();

  await page.waitForTimeout(1500);

  await testInfo.attach("stage-status", {
    body: await status.textContent(),
    contentType: "text/plain",
  });
  await testInfo.attach("console-log", {
    body: consoleMessages.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("console-errors", {
    body: consoleErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("page-errors", {
    body: pageErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("mmd-failed-requests", {
    body: failedRequests.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("stage-screenshot", {
    body: await canvas.screenshot(),
    contentType: "image/png",
  });

  expect(consoleErrors, `Console errors:\n${consoleErrors.join("\n")}`).toHaveLength(0);
  expect(pageErrors, `Page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  expect(failedRequests, `MMD request failures:\n${failedRequests.join("\n")}`).toHaveLength(0);
  await expect(status).toContainText("Model ready");
});

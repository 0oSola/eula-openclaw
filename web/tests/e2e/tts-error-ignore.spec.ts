import { expect, test, type Page } from "@playwright/test";

function seedSession(page: Page) {
  return page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "classic" }),
    );
  });
}

test("chat stays usable when TTS request fails after a successful text send", async ({ page }) => {
  await seedSession(page);

  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/assets/mmd/models", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/chat", async (route) => {
    await route.fulfill({
      json: {
        trace_id: "trace-tts-fail",
        text: "这是聊天成功但 TTS 失败后的回复。",
        emotion: "thinking",
        action: "think",
        motion_plan: {
          sequence: [
            { template: "thinking_tilt", duration_ms: 1700, intensity: 0.6 },
            { template: "listen_lean", duration_ms: 1800, intensity: 0.45 },
          ],
        },
        memory_ops: [],
        parse_mode: "json_raw",
        endpoint_used: "/chat",
        degraded: false,
        fallback_reason: null,
      },
    });
  });
  await page.route("**/tts/speak", async (route) => {
    await route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ detail: "mocked TTS failure" }),
    });
  });

  await page.goto("/companion");
  await page.getByTestId("mio-command-bar").waitFor({ state: "visible" });

  const checkbox = page.locator(".mio-tts-input");
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
  }
  await page.locator(".mio-voice-mode select").selectOption("server");
  await page.locator(".mio-command-input").fill("测试开启 TTS 时发送文本");
  await page.locator(".mio-send").click();

  await expect(page.locator(".mio-toast")).toContainText("mocked TTS failure");
  await expect(page.locator(".mio-error")).toHaveCount(0);
  await expect(page.getByText("发送失败，请检查 API 服务状态和配置。")).toHaveCount(0);
  await expect(page.getByText("这是聊天成功但 TTS 失败后的回复。")).toBeVisible();
});

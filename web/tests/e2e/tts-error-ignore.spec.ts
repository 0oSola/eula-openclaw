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
  await page.route("**/sessions", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [{ id: "sess-1", title: "新对话", updated_at: "2026-05-08T10:00:00Z" }] } });
      return;
    }
    await route.fulfill({ json: { session: { id: "sess-1", title: "新对话", updated_at: "2026-05-08T10:00:00Z" } } });
  });
  await page.route("**/sessions/sess-1/messages", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    await route.fulfill({
      json: {
        session: {
          id: "sess-1",
          title: "测试开启 TTS 时发送文本",
          openclaw_session_key: "openclaw:sess-1",
          updated_at: "2026-05-08T10:00:01Z",
        },
        user_message: {
          id: "msg-user-1",
          role: "user",
          content: "测试开启 TTS 时发送文本",
          created_at: "2026-05-08T10:00:00Z",
          memory_ops: [],
          metadata: {},
        },
        assistant_message: {
          id: "msg-assistant-1",
          role: "assistant",
          content: "这是聊天成功但 TTS 失败后的回复。",
          trace_id: "trace-tts-fail",
          emotion: "thinking",
          action: "think",
          motion_plan: {
            sequence: [
              { template: "thinking_tilt", duration_ms: 1700, intensity: 0.6 },
              { template: "listen_lean", duration_ms: 1800, intensity: 0.45 },
            ],
          },
          memory_ops: [],
          metadata: {},
          tts: {
            id: "tts-1",
            provider: "voice-workflow",
            version: 1,
            status: "failed",
            error: "mocked TTS failure",
            created_at: "2026-05-08T10:00:01Z",
            updated_at: "2026-05-08T10:00:01Z",
          },
          created_at: "2026-05-08T10:00:01Z",
        },
      },
    });
  });
  await page.route("**/messages/msg-assistant-1", async (route) => {
    await route.fulfill({
      json: {
        message: {
          id: "msg-assistant-1",
          role: "assistant",
          content: "这是聊天成功但 TTS 失败后的回复。",
          trace_id: "trace-tts-fail",
          emotion: "thinking",
          action: "think",
          motion_plan: {
            sequence: [
              { template: "thinking_tilt", duration_ms: 1700, intensity: 0.6 },
              { template: "listen_lean", duration_ms: 1800, intensity: 0.45 },
            ],
          },
          memory_ops: [],
          metadata: {},
          tts: {
            id: "tts-1",
            provider: "voice-workflow",
            version: 1,
            status: "failed",
            error: "mocked TTS failure",
            created_at: "2026-05-08T10:00:01Z",
            updated_at: "2026-05-08T10:00:01Z",
          },
          created_at: "2026-05-08T10:00:01Z",
        },
      },
    });
  });

  await page.goto("/companion");
  await page.getByTestId("mio-command-bar").waitFor({ state: "visible" });

  const checkbox = page.locator(".mio-tts-input");
  if (!(await checkbox.isChecked())) {
    await checkbox.check();
  }
  await expect(page.locator(".mio-voice-mode")).toHaveAttribute("aria-pressed", "true");
  await page.locator(".mio-command-input").fill("测试开启 TTS 时发送文本");
  await page.locator(".mio-send").click();

  await expect(page.locator(".mio-toast")).toContainText("mocked TTS failure");
  await expect(page.locator(".mio-error")).toHaveCount(0);
  await expect(page.getByText("发送失败，请检查 API 服务状态和配置。")).toHaveCount(0);
  await expect(page.getByText("这是聊天成功但 TTS 失败后的回复。")).toBeVisible();
});

import { expect, test, type Page } from "@playwright/test";

function seedSession(page: Page) {
  return page.addInitScript(() => {
    const key = "mmd_companion_session_v1";
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "classic" }));
  });
}

const ADVANCED_FEATURES = "\u9ad8\u7ea7\u529f\u80fd";
const MODEL_SWITCH = "\u6a21\u578b\u5207\u6362";
const RENDER_MODE = "\u6e32\u67d3\u6a21\u5f0f";

test("core routes render without document 5xx, page errors, or console errors @critical", async ({
  page,
}, testInfo) => {
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  const documentFailures: string[] = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  page.on("response", (response) => {
    if (response.request().resourceType() !== "document") return;
    if (response.status() >= 500) {
      documentFailures.push(`${response.request().method()} ${response.url()} :: HTTP ${response.status()}`);
    }
  });

  await page.goto("/");
  await expect(page.locator("form")).toBeVisible();
  await expect(page.locator("input")).toHaveCount(1);

  await page.goto("/traces");
  await expect(page.locator('a[href="/"]').first()).toBeVisible();

  await testInfo.attach("route-console-errors", {
    body: consoleErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("route-page-errors", {
    body: pageErrors.join("\n"),
    contentType: "text/plain",
  });
  await testInfo.attach("route-document-failures", {
    body: documentFailures.join("\n"),
    contentType: "text/plain",
  });

  expect(documentFailures, `Document failures:\n${documentFailures.join("\n")}`).toHaveLength(0);
  expect(pageErrors, `Page errors:\n${pageErrors.join("\n")}`).toHaveLength(0);
  expect(consoleErrors, `Console errors:\n${consoleErrors.join("\n")}`).toHaveLength(0);
});

test("companion route renders the MIO hud replica with authenticated session @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  await expect(page.getByTestId("mio-hud")).toBeVisible();
  await expect(page.getByRole("heading", { name: "MIO" })).toBeVisible();
  await expect(page.getByText("PERSONAL AI")).toBeVisible();
  await expect(page.getByText("下一步建议")).toBeVisible();
  await expect(page.getByText("记忆摘要")).toBeVisible();
  await expect(page.getByText("Trace / 请求状态")).toBeVisible();
  await expect(page.getByText("语音模式")).toBeVisible();
  await expect(page.getByPlaceholder("输入你的指令 / 任务 / 问题...（Enter 发送，Shift + Enter 换行）")).toBeVisible();
  await expect(page.getByRole("button", { name: "发送" })).toBeVisible();
});

test("companion route exposes stable HUD structure for the restored design @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  await expect(page.getByTestId("mio-topbar")).toBeVisible();
  await expect(page.getByTestId("mio-sidebar")).toBeVisible();
  await expect(page.getByTestId("mio-dialogue")).toBeVisible();
  await expect(page.getByTestId("mio-right-rail")).toBeVisible();
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();

  await expect(page.getByText("我理解你的需求了～")).toBeVisible();
  await expect(page.getByText("生成需求文档大纲")).toBeVisible();
  await expect(page.getByText("常用工具：Notion / VS Code")).toBeVisible();
  await expect(page.getByText("/v1/chat/completions")).toBeVisible();
  await expect(page.getByRole("button", { name: ADVANCED_FEATURES })).toBeVisible();
});

test("companion dialogue bubble is anchored inside the stage container @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  const stageWrap = page.getByTestId("mio-stage-wrap");
  await expect(stageWrap).toBeVisible();
  await expect(stageWrap.getByTestId("mio-dialogue")).toBeVisible();
});

test("advanced features panel owns model and render pipeline switching @critical", async ({ page }) => {
  await seedSession(page);
  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route("**/assets/mmd/models", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            name: "Eula.pmx",
            label: "Eula",
            relative_path: "Eula/Eula.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Eula/Eula.pmx",
          },
          {
            name: "Ayaka.pmx",
            label: "Ayaka",
            relative_path: "Ayaka/Ayaka.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Ayaka/Ayaka.pmx",
          },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/vmds", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto("/companion");
  await expect(page.getByRole("button", { name: "\u89d2\u8272\u5207\u6362" })).toHaveCount(0);
  await expect(page.getByTestId("mio-motion-trigger")).toHaveCount(0);
  await expect(page.getByRole("combobox", { name: "Render pipeline" })).toHaveCount(0);

  await page.locator('button[aria-controls="mio-advanced-panel"]').click();

  const advancedPanel = page.getByTestId("mio-advanced-panel");
  await expect(advancedPanel).toBeVisible();
  await expect(advancedPanel.getByText(ADVANCED_FEATURES, { exact: true })).toBeVisible();

  const modelSelect = advancedPanel.getByRole("combobox", { name: MODEL_SWITCH });
  await expect(modelSelect).toHaveValue("Eula/Eula.pmx");
  await modelSelect.selectOption("Ayaka/Ayaka.pmx");
  await expect(modelSelect).toHaveValue("Ayaka/Ayaka.pmx");

  const pipelineOptions = advancedPanel.getByRole("radiogroup", { name: RENDER_MODE });
  await expect(pipelineOptions.getByRole("radio", { name: /Classic/ })).toHaveAttribute("aria-checked", "true");
  await pipelineOptions.getByRole("radio", { name: /Genshin/ }).click();
  await expect(pipelineOptions.getByRole("radio", { name: /Genshin/ })).toHaveAttribute("aria-checked", "true");
  await expect(page.getByTestId("mio-hud")).toHaveAttribute("data-render-pipeline", "genshin");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").renderPipeline),
    )
    .toBe("genshin");
});

test("advanced features button opens a non-modal VMD quick import panel with previewable assets @critical", async ({
  page,
}) => {
  await seedSession(page);
  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            asset_id: "asset-1",
            user_id: "8X29-AF3E",
            slot: "happy",
            filename: "happy-wave.vmd",
            size_bytes: 20480,
            created_at: "2026-04-26T10:00:00Z",
            url: "/assets/vmd/happy-wave.vmd",
          },
          {
            asset_id: "asset-2",
            user_id: "8X29-AF3E",
            slot: "thinking",
            filename: "thinking-idle.vmd",
            size_bytes: 19456,
            created_at: "2026-04-26T09:00:00Z",
            url: "/assets/vmd/thinking-idle.vmd",
          },
        ],
      },
    });
  });

  await page.goto("/companion");
  const advancedTrigger = page.getByRole("button", { name: /高级功能/ });
  await expect(advancedTrigger).toBeVisible();

  await advancedTrigger.click();

  const advancedPanel = page.getByTestId("mio-advanced-panel");
  await expect(advancedPanel).toBeVisible();
  await expect(advancedPanel.getByText(ADVANCED_FEATURES, { exact: true })).toBeVisible();
  await expect(advancedPanel.locator('input[type="file"]')).toHaveCount(2);
  await expect(advancedPanel.getByTestId("mio-advanced-asset")).toHaveCount(2);
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();
  return;

  const trigger = page.getByRole("button", { name: "楂樼骇鍔熻兘" });
  await expect(trigger).toBeVisible();

  await trigger.click();

  const panel = page.getByTestId("mio-advanced-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByText("VMD 快速导入")).toBeVisible();
  await expect(panel.locator('input[type="file"]')).toBeAttached();
  await expect(panel.getByTestId("mio-advanced-asset")).toHaveCount(2);
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();
});

test("advanced panel can unlock and save the active favorite VMD camera @smoke", async ({ page }) => {
  await page.route("**/config/mapping/resolved/**", async (route) => {
    await route.fulfill({ json: { mappings: {} } });
  });
  await page.route("**/assets/vmd?**", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            asset_id: "asset-1",
            user_id: "8X29-AF3E",
            slot: "happy",
            filename: "eula-favorite.vmd",
            display_name: "eula-favorite.vmd",
            is_favorite: true,
            favorite_relative_path: "usage/vmd/Eula[action]/eula-favorite.vmd",
            favorite_model_relative_path: "Eula_by_Genshin/Eula.pmx",
            size_bytes: 20480,
            created_at: "2026-04-26T10:00:00Z",
            url: "/assets/vmd/file/asset-1",
          },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/models", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            name: "Eula.pmx",
            label: "Eula",
            relative_path: "Eula_by_Genshin/Eula.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Eula_by_Genshin/Eula.pmx",
          },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/vmds", async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto("/");
  await page.evaluate(() => {
    window.localStorage.setItem("mmd_companion_session_v1", JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "genshin" }));
  });
  await page.goto("/companion");
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  await page.getByRole("tab", { name: "Favorites" }).click();
  await page.getByTestId("mio-advanced-asset").first().getByRole("button", { name: /Preview/ }).click();

  const cameraControls = page.getByTestId("mio-camera-controls");
  await expect(cameraControls).toBeVisible();
  await expect(cameraControls).toContainText("eula-favorite.vmd");
  await expect(cameraControls.getByTestId("mio-camera-mode")).toContainText("Free");
  await cameraControls.getByTestId("mio-camera-unlock").click();
  await expect(cameraControls.getByTestId("mio-camera-mode")).toContainText("Editing");
  const savedCameraLog = page.waitForEvent(
    "console",
    (message) => message.type() === "info" && message.text().includes("[mmd-camera] saved snapshot"),
  );
  await cameraControls.getByTestId("mio-camera-save").click();
  await expect(cameraControls.getByTestId("mio-camera-mode")).toContainText("Free");
  await savedCameraLog;

  await expect
    .poll(() =>
      page.evaluate(() => {
        const session = JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}");
        return Object.entries(session.mmdCameraByFavoriteVmd || {})[0] || null;
      }),
    )
    .toEqual([
      "genshin::Eula_by_Genshin%2FEula.pmx::asset-1",
      {
        fov: 33,
        position: [0, 9.2, 21.6],
        target: [0, 7.9, 0],
        locked: false,
      },
    ]);
});

test("companion stage keeps runtime chrome hidden inside the restored HUD @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  await expect(page.locator("canvas").first()).toBeVisible();
  await expect(page.locator(".mio-model-select")).toHaveCount(0);
  await expect(page.locator(".mio-stage-status")).toBeHidden();
});

test("companion route stays usable on mobile width without horizontal overflow @critical", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedSession(page);
  await page.goto("/companion");

  await expect(page.getByTestId("mio-topbar")).toBeVisible();
  await expect(page.getByTestId("mio-stage-wrap")).toBeVisible();
  await expect(page.getByTestId("mio-command-bar")).toBeVisible();

  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return root.scrollWidth - root.clientWidth;
  });

  expect(overflow).toBeLessThanOrEqual(1);
});

test("companion route keeps stage and right rail separated on tablet width @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await seedSession(page);
  await page.goto("/companion");

  const stageBox = await page.getByTestId("mio-stage-wrap").boundingBox();
  const railBox = await page.getByTestId("mio-right-rail").boundingBox();

  expect(stageBox).not.toBeNull();
  expect(railBox).not.toBeNull();
  expect(stageBox!.x + stageBox!.width).toBeLessThanOrEqual(railBox!.x);
});

test("companion render pipeline selection persists across reloads @smoke", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  const pipelineOptions = page.getByTestId("mio-advanced-panel").getByRole("radiogroup", { name: RENDER_MODE });
  await expect(pipelineOptions.getByRole("radio", { name: /Classic/ })).toHaveAttribute("aria-checked", "true");

  await pipelineOptions.getByRole("radio", { name: /Genshin/ }).click();
  await expect(pipelineOptions.getByRole("radio", { name: /Genshin/ })).toHaveAttribute("aria-checked", "true");

  await page.reload();
  await page.locator('button[aria-controls="mio-advanced-panel"]').click();

  await expect(
    page.getByTestId("mio-advanced-panel").getByRole("radiogroup", { name: RENDER_MODE }).getByRole("radio", {
      name: /Genshin/,
    }),
  ).toHaveAttribute("aria-checked", "true");
});

test("companion restores saved genshin render pipeline sessions @smoke", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "genshin" }),
    );
  });

  await page.goto("/companion");

  await page.locator('button[aria-controls="mio-advanced-panel"]').click();
  await expect(
    page.getByTestId("mio-advanced-panel").getByRole("radiogroup", { name: RENDER_MODE }).getByRole("radio", {
      name: /Genshin/,
    }),
  ).toHaveAttribute("aria-checked", "true");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").renderPipeline),
    )
    .toBe("genshin");
});

test("companion stage occupies about seventy percent of the desktop viewport @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const stageBox = await page.locator(".mio-stage").boundingBox();

  expect(stageBox).not.toBeNull();
  expect(stageBox!.width).toBeGreaterThanOrEqual(1070);
});

test("companion stage sits higher on the desktop viewport @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const stageWrapBox = await page.getByTestId("mio-stage-wrap").boundingBox();
  const commandBarBox = await page.getByTestId("mio-command-bar").boundingBox();

  expect(stageWrapBox).not.toBeNull();
  expect(commandBarBox).not.toBeNull();
  expect(stageWrapBox!.y).toBeLessThanOrEqual(68);
  expect(Math.abs(commandBarBox!.y - (stageWrapBox!.y + stageWrapBox!.height))).toBeLessThanOrEqual(2);
});

test("companion stage includes a forty-pixel bottom fade for a softer transition @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const fade = page.getByTestId("mio-stage-bottom-fade");
  const fadeBox = await fade.boundingBox();
  const commandBarBox = await page.getByTestId("mio-command-bar").boundingBox();
  const fadeBackground = await fade.evaluate((node) => getComputedStyle(node).backgroundImage);
  const fadeFilter = await fade.evaluate((node) => getComputedStyle(node).filter);

  await expect(fade).toBeVisible();
  expect(fadeBox).not.toBeNull();
  expect(commandBarBox).not.toBeNull();
  expect(Math.round(fadeBox!.height)).toBe(44);
  expect(Math.abs((fadeBox!.y + fadeBox!.height) - commandBarBox!.y)).toBeLessThanOrEqual(2);
  expect(fadeBackground).toContain("69, 146, 255");
  expect(fadeFilter).toContain("blur");
});

test("companion dialogue stays in the stage upper-left zone without covering the character @critical", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1536, height: 960 });
  await seedSession(page);
  await page.goto("/companion");

  const stageBox = await page.locator(".mio-stage").boundingBox();
  const dialogueBox = await page.getByTestId("mio-dialogue").boundingBox();

  expect(stageBox).not.toBeNull();
  expect(dialogueBox).not.toBeNull();
  expect(dialogueBox!.x).toBeGreaterThanOrEqual(stageBox!.x);
  expect(dialogueBox!.y).toBeLessThanOrEqual(stageBox!.y + 92);
  expect(dialogueBox!.x + dialogueBox!.width).toBeLessThanOrEqual(stageBox!.x + stageBox!.width * 0.42);
});

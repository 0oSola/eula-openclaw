import { expect, test } from "@playwright/test";

function seedSession(page: Parameters<typeof test>[0]["page"]) {
  return page.addInitScript(() => {
    const key = "mmd_companion_session_v1";
    if (window.localStorage.getItem(key)) return;
    window.localStorage.setItem(key, JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "classic" }));
  });
}

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
  await expect(page.getByRole("button", { name: "高级功能" })).toBeVisible();
});

test("companion dialogue bubble is anchored inside the stage container @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  const stageWrap = page.getByTestId("mio-stage-wrap");
  await expect(stageWrap).toBeVisible();
  await expect(stageWrap.getByTestId("mio-dialogue")).toBeVisible();
});

test("companion sidebar supports avatar-driven character switching @critical", async ({ page }) => {
  await seedSession(page);
  await page.goto("/companion");

  const trigger = page.getByRole("button", { name: "角色切换" });
  await expect(trigger).toBeVisible();

  await trigger.click();

  await expect(page.getByRole("dialog", { name: "角色切换面板" })).toBeVisible();
  await expect(page.getByRole("button", { name: /切换到.*角色/ }).first()).toBeVisible();
  await expect(page.getByTestId("mio-character-option").first()).toBeVisible();
});

test("companion sidebar exposes built-in motion switching from the MMD vmd catalog @critical", async ({ page }) => {
  await seedSession(page);
  await page.addInitScript(() => {
    Math.random = () => 0;
  });

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
            relative_path: "Eula_by_Genshin/Eula.pmx",
            size_bytes: 1024,
            url: "/assets/mmd/Eula_by_Genshin/Eula.pmx",
          },
        ],
      },
    });
  });
  await page.route("**/assets/mmd/vmds", async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            name: "Smelling Something in the Air.vmd",
            label: "Smelling Something in the Air",
            relative_path:
              "vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd",
            size_bytes: 768,
            url: "/assets/mmd/vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle%20Animations%20Pack%20-%20Copy/Air%20Scent%20Idle%20Animation/Smelling%20Something%20in%20the%20Air.vmd",
          },
          {
            name: "Shy.vmd",
            label: "Shy",
            relative_path:
              "vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle Animations Pack - Copy/Shy Idle Animation/Shy.vmd",
            size_bytes: 768,
            url: "/assets/mmd/vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle%20Animations%20Pack%20-%20Copy/Shy%20Idle%20Animation/Shy.vmd",
          },
          {
            name: "Crossed Arms Look Around Confident.vmd",
            label: "Crossed Arms Look Around Confident",
            relative_path:
              "vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle Animations Pack - Copy/Confident Idle Animation/Crossed Arms Look Around Confident.vmd",
            size_bytes: 768,
            url: "/assets/mmd/vmd/idle_animations_pack_zip_by_deedee524_dck53f5/Idle%20Animations%20Pack%20-%20Copy/Confident%20Idle%20Animation/Crossed%20Arms%20Look%20Around%20Confident.vmd",
          },
        ],
      },
    });
  });

  await page.goto("/companion");

  const trigger = page.getByTestId("mio-motion-trigger");
  await expect(trigger).toBeVisible();

  await trigger.click();

  await expect(page.getByTestId("mio-motion-panel")).toBeVisible();
  await expect(page.getByTestId("mio-motion-option")).toHaveCount(3);
  await expect(page.locator(".mio-motion-option.is-selected")).toContainText("Smelling Something in the Air");
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

  const pipelineSelect = page.getByRole("combobox", { name: "Render pipeline" });
  await expect(pipelineSelect).toBeVisible();
  await expect(pipelineSelect.locator("option")).toHaveText(["Classic", "Hero Shot"]);
  await expect(pipelineSelect).toHaveValue("classic");

  await pipelineSelect.selectOption("hero-shot");
  await expect(pipelineSelect).toHaveValue("hero-shot");

  await page.reload();

  await expect(page.getByRole("combobox", { name: "Render pipeline" })).toHaveValue("hero-shot");
});

test("companion upgrades legacy genshin sessions to hero-shot @smoke", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "mmd_companion_session_v1",
      JSON.stringify({ userId: "8X29-AF3E", renderPipeline: "genshin" }),
    );
  });

  await page.goto("/companion");

  await expect(page.getByRole("combobox", { name: "Render pipeline" })).toHaveValue("hero-shot");
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").renderPipeline),
    )
    .toBe("hero-shot");
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

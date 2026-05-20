import { expect, Page, test } from "@playwright/test";

function rgbaAlpha(value: string) {
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return 1;
  const parts = match[1].split(",").map((part) => part.trim());
  if (parts.length < 4) return 1;
  return Number(parts[3]);
}

async function finishLoginIntro(page: Page) {
  const intro = page.getByTestId("login-v2-intro");
  const backgroundVideo = page.getByTestId("login-v2-background-video");
  await page.getByTestId("login-v2-intro-video").dispatchEvent("ended");
  await expect(page.getByTestId("login-v2-shell")).toHaveAttribute("data-intro-state", "revealing");
  await expect(backgroundVideo).toHaveAttribute("data-idle-state", "playing");
  await expect(backgroundVideo).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("login-v2-panel")).toBeVisible();
  await expect(intro).toBeHidden();
  await page.getByTestId("login-v2-panel").dispatchEvent("animationend");
  await expect(page.getByTestId("login-v2-shell")).toHaveAttribute("data-intro-state", "complete");
  await expect(intro).toBeHidden();
  await expect(backgroundVideo).toHaveCSS("opacity", "1");
}

test("root V2 login hands off from intro video to the looping idle background @critical", async ({ page }) => {
  await page.goto("/");

  const intro = page.getByTestId("login-v2-intro");
  const introVideo = page.getByTestId("login-v2-intro-video");
  const panel = page.getByTestId("login-v2-panel");
  const backgroundVideo = page.getByTestId("login-v2-background-video");

  await expect(intro).toBeVisible();
  await expect(introVideo).toHaveAttribute("src", /\/images\/loginV2\/login_video\.mp4$/);
  await expect(panel).toBeHidden();
  await expect(backgroundVideo).toHaveAttribute("src", /\/images\/loginV2\/idle_login\.mp4$/);
  await expect(backgroundVideo).toHaveAttribute("data-video-slot", "idle-character-breathing-loop");
  await expect(backgroundVideo).toHaveAttribute("data-idle-state", "waiting");
  const backgroundVideoState = await backgroundVideo.evaluate((node) => {
    const video = node as HTMLVideoElement;
    return {
      loop: video.loop,
      muted: video.muted,
      playsInline: video.playsInline,
      preload: video.getAttribute("preload"),
      src: video.getAttribute("src"),
      opacity: getComputedStyle(video).opacity,
    };
  });
  expect(backgroundVideoState).toEqual({
    loop: true,
    muted: true,
    playsInline: true,
    preload: "auto",
    src: "/images/loginV2/idle_login.mp4",
    opacity: "0",
  });

  await introVideo.dispatchEvent("ended");

  await expect(page.getByTestId("login-v2-shell")).toHaveAttribute("data-intro-state", "revealing");
  await expect(intro).toHaveAttribute("data-intro-phase", "revealing");
  await expect(backgroundVideo).toHaveAttribute("data-idle-state", "playing");
  const immediateHandoffStyle = await page.evaluate(() => {
    const intro = document.querySelector('[data-testid="login-v2-intro"]');
    const introVideo = document.querySelector('[data-testid="login-v2-intro-video"]');
    const backgroundVideo = document.querySelector('[data-testid="login-v2-background-video"]');
    if (!intro || !introVideo || !backgroundVideo) throw new Error("Missing login handoff elements");
    const introStyle = getComputedStyle(intro);
    const introVideoStyle = getComputedStyle(introVideo);
    const backgroundStyle = getComputedStyle(backgroundVideo);
    return {
      backgroundOpacity: Number.parseFloat(backgroundStyle.opacity),
      backgroundTransitionDuration: backgroundStyle.transitionDuration,
      introOpacity: introStyle.opacity,
      introPointerEvents: introStyle.pointerEvents,
      introVisibility: introStyle.visibility,
      introVideoAnimationName: introVideoStyle.animationName,
    };
  });
  expect(immediateHandoffStyle.backgroundOpacity).toBeGreaterThanOrEqual(0.99);
  expect(immediateHandoffStyle.backgroundTransitionDuration).toBe("0s");
  expect(immediateHandoffStyle.introOpacity).toBe("0");
  expect(immediateHandoffStyle.introPointerEvents).toBe("none");
  expect(immediateHandoffStyle.introVisibility).toBe("hidden");
  expect(immediateHandoffStyle.introVideoAnimationName).toBe("none");
  await expect(panel).toBeVisible();

  const revealStyle = await intro.evaluate((node) => {
    const introStyle = getComputedStyle(node);
    const video = node.querySelector('[data-testid="login-v2-intro-video"]');
    const videoStyle = video ? getComputedStyle(video) : null;
    return {
      opacity: introStyle.opacity,
      pointerEvents: introStyle.pointerEvents,
      visibility: introStyle.visibility,
      zIndex: introStyle.zIndex,
      videoAnimationName: videoStyle?.animationName ?? "",
    };
  });
  expect(revealStyle.opacity).toBe("0");
  expect(revealStyle.pointerEvents).toBe("none");
  expect(revealStyle.visibility).toBe("hidden");
  expect(Number(revealStyle.zIndex)).toBeLessThan(5);
  expect(revealStyle.videoAnimationName).toBe("none");

  await panel.dispatchEvent("animationend");

  await expect(page.getByTestId("login-v2-shell")).toHaveAttribute("data-intro-state", "complete");
  await expect(intro).toBeHidden();
  await expect(intro).toHaveAttribute("data-intro-phase", "complete");
  await expect(backgroundVideo).toHaveCSS("opacity", "1");

  const completeStyle = await intro.evaluate((node) => {
    const introStyle = getComputedStyle(node);
    const video = node.querySelector('[data-testid="login-v2-intro-video"]');
    const videoStyle = video ? getComputedStyle(video) : null;
    return {
      opacity: introStyle.opacity,
      pointerEvents: introStyle.pointerEvents,
      visibility: introStyle.visibility,
      zIndex: introStyle.zIndex,
      videoOpacity: videoStyle?.opacity ?? "",
      videoAnimationName: videoStyle?.animationName ?? "",
    };
  });
  expect(completeStyle.opacity).toBe("0");
  expect(completeStyle.pointerEvents).toBe("none");
  expect(completeStyle.visibility).toBe("hidden");
  expect(Number(completeStyle.zIndex)).toBeLessThan(1);
  expect(completeStyle.videoOpacity).toBe("1");
  expect(completeStyle.videoAnimationName).toBe("none");
});

test("root V2 login intro can be skipped with a double click @critical", async ({ page }) => {
  await page.goto("/");

  await page.getByTestId("login-v2-intro").dblclick();

  await expect(page.getByTestId("login-v2-shell")).toHaveAttribute("data-intro-state", "revealing");
  await expect(page.getByTestId("login-v2-background-video")).toHaveAttribute("data-idle-state", "playing");
  await expect(page.getByTestId("login-v2-intro")).toBeHidden();
  await expect(page.getByTestId("login-v2-panel")).toBeVisible();

  await page.getByTestId("login-v2-panel").dispatchEvent("animationend");

  await expect(page.getByTestId("login-v2-shell")).toHaveAttribute("data-intro-state", "complete");
  await expect(page.getByTestId("login-v2-intro")).toBeHidden();
  await expect(page.getByTestId("login-v2-background-video")).toHaveCSS("opacity", "1");
});

test("root route renders the AETHER V2 login with loginV2 assets @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/");
  await finishLoginIntro(page);

  const shell = page.getByTestId("login-v2-shell");
  const panel = page.getByTestId("login-v2-panel");
  const brand = page.getByTestId("login-v2-brand");
  const brandMark = page.getByTestId("login-v2-brand-mark");
  const brandWordmark = page.getByTestId("login-v2-brand-wordmark");
  const connectPanel = page.getByTestId("login-v2-connect-panel");
  const submit = page.getByTestId("login-v2-submit");

  await expect(shell).toHaveAttribute("data-login-version", "aether-login-v2-source-bitmap-v1");
  const shellBackgroundImage = await shell.evaluate((node) => getComputedStyle(node).backgroundImage);
  expect(shellBackgroundImage).not.toContain("login_background.png");
  await expect(panel).toBeVisible();
  await expect(brand).toHaveAttribute("data-logo-layout", "aether-v2-mark-left-wordmark-right");
  await expect(brandMark).toHaveCSS("background-image", /aether-mark-crop\.png/);
  await expect(brandWordmark).toHaveCSS("background-image", /aether-wordmark-crop\.png/);
  await expect(panel.getByRole("heading", { name: "欢迎登录 AETHER" })).toBeVisible();
  await expect(panel.getByPlaceholder("账号 / 邮箱")).toBeVisible();
  await expect(panel.getByPlaceholder("密码")).toBeVisible();
  await expect(page.getByTestId("login-v2-user-icon")).toHaveClass(/lucide-user-round/);
  await expect(page.getByTestId("login-v2-lock-icon")).toHaveClass(/lucide-lock-keyhole/);
  await expect(page.getByTestId("login-v2-eye-icon")).toHaveClass(/lucide-eye/);
  await expect(submit).toBeVisible();
  await expect(submit).toHaveText("进入系统");
  await expect(submit).toHaveCSS("background-image", /login_button-crop-transparent\.png/);
  await expect(connectPanel).toBeVisible();
  await expect(connectPanel).toHaveCSS("background-image", /connect_panel-crop-transparent\.png/);
  const panelBackdropFilters = await panel.evaluate((node) => {
    const before = getComputedStyle(node, "::before") as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
    };
    return [before.backdropFilter, before.webkitBackdropFilter || ""];
  });
  expect(panelBackdropFilters.every((value) => value === "" || value === "none")).toBe(true);

  const layout = await page.evaluate(() => {
    const root = document.documentElement;
    const panel = document.querySelector('[data-testid="login-v2-panel"]')?.getBoundingClientRect();
    const connect = document.querySelector('[data-testid="login-v2-connect-panel"]')?.getBoundingClientRect();
    return {
      horizontalOverflow: root.scrollWidth - root.clientWidth,
      panelLeft: panel?.left ?? 0,
      panelTop: panel?.top ?? 0,
      panelWidth: panel?.width ?? 0,
      panelHeight: panel?.height ?? 0,
      connectLeft: connect?.left ?? 0,
      connectRight: connect ? window.innerWidth - connect.right : 0,
      connectTop: connect?.top ?? 0,
      connectWidth: connect?.width ?? 0,
      brandMarkLeft: document.querySelector('[data-testid="login-v2-brand-mark"]')?.getBoundingClientRect().left ?? 0,
      brandMarkRight: document.querySelector('[data-testid="login-v2-brand-mark"]')?.getBoundingClientRect().right ?? 0,
      brandWordmarkLeft: document.querySelector('[data-testid="login-v2-brand-wordmark"]')?.getBoundingClientRect().left ?? 0,
      brandWordmarkRight: document.querySelector('[data-testid="login-v2-brand-wordmark"]')?.getBoundingClientRect().right ?? 0,
    };
  });

  expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(layout.panelLeft).toBeGreaterThanOrEqual(170);
  expect(layout.panelLeft).toBeLessThanOrEqual(250);
  expect(layout.panelTop).toBeGreaterThanOrEqual(110);
  expect(layout.panelTop).toBeLessThanOrEqual(170);
  expect(layout.panelWidth).toBeGreaterThanOrEqual(490);
  expect(layout.panelWidth).toBeLessThanOrEqual(550);
  expect(layout.panelHeight).toBeGreaterThanOrEqual(610);
  expect(layout.panelHeight).toBeLessThanOrEqual(670);
  expect(layout.connectLeft).toBeGreaterThanOrEqual(1280);
  expect(layout.connectLeft).toBeLessThanOrEqual(1320);
  expect(layout.connectRight).toBeGreaterThanOrEqual(70);
  expect(layout.connectRight).toBeLessThanOrEqual(110);
  expect(layout.connectTop).toBeGreaterThanOrEqual(245);
  expect(layout.connectTop).toBeLessThanOrEqual(270);
  expect(layout.connectWidth).toBeGreaterThanOrEqual(270);
  expect(layout.connectWidth).toBeLessThanOrEqual(300);
  expect(layout.brandMarkLeft).toBeLessThan(layout.brandWordmarkLeft);
  expect(layout.brandMarkRight).toBeLessThanOrEqual(layout.brandWordmarkLeft - 12);
  expect(layout.brandWordmarkRight).toBeLessThanOrEqual(layout.panelLeft + layout.panelWidth - 56);
});

test("root V2 login keeps breathable design spacing and only the bitmap panel layer @critical", async ({ page }) => {
  await page.setViewportSize({ width: 1672, height: 941 });
  await page.goto("/");
  await finishLoginIntro(page);

  const layout = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const bounds = element.getBoundingClientRect();
      return {
        top: bounds.top,
        bottom: bounds.bottom,
        height: bounds.height,
      };
    };

    const panel = document.querySelector('[data-testid="login-v2-panel"]');
    if (!panel) throw new Error("Missing login-v2 panel");
    const panelStyle = getComputedStyle(panel);
    const tintStyle = getComputedStyle(panel, "::before") as CSSStyleDeclaration & {
      webkitBackdropFilter?: string;
    };
    const frameStyle = getComputedStyle(panel, "::after");
    const brand = box('[data-testid="login-v2-brand"]');
    const copy = box(".login-v2-copy");
    const account = box("#login-v2-account");
    const password = box("#login-v2-password");
    const options = box(".login-v2-options");
    const submit = box('[data-testid="login-v2-submit"]');
    const register = box('[data-testid="login-v2-register"]');
    const footnote = box(".login-v2-footnote");

    return {
      panelBackgroundColor: panelStyle.backgroundColor,
      tintBackgroundColor: tintStyle.backgroundColor,
      tintBackdropFilter: tintStyle.backdropFilter,
      tintWebkitBackdropFilter: tintStyle.webkitBackdropFilter || "",
      tintInset: tintStyle.inset,
      frameInset: frameStyle.inset,
      frameOpacity: frameStyle.opacity,
      gaps: {
        brandToCopy: Math.round(copy.top - brand.bottom),
        copyToAccount: Math.round(account.top - copy.bottom),
        accountToPassword: Math.round(password.top - account.bottom),
        passwordToOptions: Math.round(options.top - password.bottom),
        optionsToSubmit: Math.round(submit.top - options.bottom),
        submitToRegister: Math.round(register.top - submit.bottom),
        registerToFootnote: Math.round(footnote.top - register.bottom),
      },
    };
  });

  expect(layout.gaps.brandToCopy).toBeGreaterThanOrEqual(40);
  expect(layout.gaps.copyToAccount).toBeGreaterThanOrEqual(28);
  expect(layout.gaps.accountToPassword).toBeGreaterThanOrEqual(18);
  expect(layout.gaps.passwordToOptions).toBeGreaterThanOrEqual(16);
  expect(layout.gaps.optionsToSubmit).toBeGreaterThanOrEqual(22);
  expect(layout.gaps.submitToRegister).toBeGreaterThanOrEqual(14);
  expect(layout.gaps.registerToFootnote).toBeGreaterThanOrEqual(22);
  expect(rgbaAlpha(layout.panelBackgroundColor)).toBeLessThanOrEqual(0.02);
  expect(layout.tintInset).toBe(layout.frameInset);
  expect(["", "none"].includes(layout.tintBackdropFilter)).toBe(true);
  expect(["", "none"].includes(layout.tintWebkitBackdropFilter)).toBe(true);
  expect(rgbaAlpha(layout.tintBackgroundColor)).toBeLessThanOrEqual(0.02);
  expect(Number(layout.frameOpacity)).toBeGreaterThanOrEqual(0.62);
  expect(Number(layout.frameOpacity)).toBeLessThanOrEqual(0.84);
});

test("root V2 login form submits to the companion route @critical", async ({ page }) => {
  await page.goto("/");
  await finishLoginIntro(page);

  await page.getByPlaceholder("账号 / 邮箱").fill("demo-user-001");
  await page.getByPlaceholder("密码").fill("demo-password");
  await page.getByTestId("login-v2-submit").click();

  await expect(page).toHaveURL(/\/companion$/);
  await expect
    .poll(() =>
      page.evaluate(() => JSON.parse(window.localStorage.getItem("mmd_companion_session_v1") || "{}").userId),
    )
    .toBe("demo-user-001");
});

test("root V2 login keeps equal action buttons and adapts the floating panel @critical", async ({ page }) => {
  for (const viewport of [
    { width: 1672, height: 941 },
    { width: 900, height: 700 },
    { width: 768, height: 600 },
    { width: 598, height: 622 },
    { width: 992, height: 620 },
    { width: 1180, height: 620 },
    { width: 390, height: 667 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await finishLoginIntro(page);

    const layout = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const bounds = element.getBoundingClientRect();
        return {
          left: bounds.left,
          top: bounds.top,
          right: bounds.right,
          bottom: bounds.bottom,
          width: bounds.width,
          height: bounds.height,
        };
      };

      const root = document.documentElement;
      return {
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
        horizontalOverflow: root.scrollWidth - root.clientWidth,
        panel: box('[data-testid="login-v2-panel"]'),
        submit: box('[data-testid="login-v2-submit"]'),
        register: box(".login-v2-register"),
        footnote: box(".login-v2-footnote"),
        content: Array.from(
          document.querySelectorAll(
            '.login-v2-copy, .login-v2-field, [data-testid="login-v2-submit"], .login-v2-register, .login-v2-footnote',
          ),
        ).map((element) => {
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left,
            right: bounds.right,
          };
        }),
      };
    });

    expect(layout.panel).not.toBeNull();
    expect(layout.submit).not.toBeNull();
    expect(layout.register).not.toBeNull();
    expect(layout.footnote).not.toBeNull();

    const panel = layout.panel!;
    const submit = layout.submit!;
    const register = layout.register!;
    const footnote = layout.footnote!;

    expect(layout.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.width - register.width)).toBeLessThanOrEqual(1);
    expect(Math.abs(submit.height - register.height)).toBeLessThanOrEqual(1);
    expect(panel.left).toBeGreaterThanOrEqual(0);
    expect(panel.top).toBeGreaterThanOrEqual(0);
    expect(panel.right).toBeLessThanOrEqual(layout.viewportWidth);
    expect(panel.bottom).toBeLessThanOrEqual(layout.viewportHeight - 8);
    expect(footnote.bottom).toBeLessThanOrEqual(panel.bottom - 8);

    const safeInlineInset = Math.min(48, Math.max(32, panel.width * 0.1));
    const contentLeftInset = Math.min(...layout.content.map((bounds) => bounds.left - panel.left));
    const contentRightInset = Math.min(...layout.content.map((bounds) => panel.right - bounds.right));
    expect(contentLeftInset).toBeGreaterThanOrEqual(safeInlineInset);
    expect(contentRightInset).toBeGreaterThanOrEqual(safeInlineInset);

    if (layout.viewportWidth > 520 && layout.viewportWidth <= 900 && layout.viewportHeight <= 700) {
      expect(panel.width).toBeLessThanOrEqual(layout.viewportHeight * 0.74);
    }
  }
});

test("root V2 login scales compact inner controls from measured CTA dimensions @critical", async ({ page }) => {
  await page.setViewportSize({ width: 598, height: 622 });
  await page.goto("/");
  await finishLoginIntro(page);

  const metrics = await page.evaluate(() => {
    const box = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) throw new Error(`Missing ${selector}`);
      const bounds = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        width: bounds.width,
        height: bounds.height,
        fontSize: Number.parseFloat(style.fontSize),
      };
    };

    return {
      submit: box('[data-testid="login-v2-submit"]'),
      register: box(".login-v2-register"),
      field: box(".login-v2-field"),
      title: box(".login-v2-copy h1"),
      wordmark: box('[data-testid="login-v2-brand-wordmark"]'),
    };
  });

  expect(metrics.submit.width).toBeLessThanOrEqual(330);
  expect(metrics.submit.height).toBeLessThanOrEqual(42);
  expect(Math.abs(metrics.register.width - metrics.submit.width)).toBeLessThanOrEqual(1);
  expect(metrics.register.height).toBeLessThanOrEqual(42);
  expect(metrics.field.width).toBeLessThanOrEqual(metrics.submit.width + 1);
  expect(metrics.field.height).toBeLessThanOrEqual(39);
  expect(metrics.title.fontSize).toBeLessThanOrEqual(22);
  expect(metrics.wordmark.width).toBeLessThanOrEqual(155);
});

test("legacy login route is removed to avoid mixed login entries @critical", async ({ page }) => {
  const response = await page.goto("/login-legacy");

  expect(response?.status()).toBe(404);
  await expect(page.getByTestId("login-panel")).toHaveCount(0);
});

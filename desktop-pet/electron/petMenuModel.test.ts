import { describe, expect, it } from "vitest";

import { buildPetMenuModel, formatSessionMenuLabel, shortSessionId } from "./petMenuModel.js";

describe("desktop pet menu model", () => {
  const defaultMenuOptions = {
    interactionMode: "window-drag",
    notificationProfile: "medium",
    menuLanguage: "en",
    sessions: [],
    apiAvailable: true,
    now: new Date("2026-06-03T00:00:00+08:00"),
    alwaysOnTop: true,
  } satisfies Parameters<typeof buildPetMenuModel>[0];

  it("formats readable restore labels without uuid noise", () => {
    const label = formatSessionMenuLabel(
      {
        display_title: "web login layout fix",
        workspace_path: "D:/workspace/MMD project",
        last_status: "waiting_approval",
        last_seen_at: "2026-06-02T15:18:00Z",
        codex_session_id: "11111111-2222-3333-4444-555555555555",
      },
      new Date("2026-06-03T00:00:00+08:00"),
    );

    expect(label).toContain("Continue: web login layout fix");
    expect(label).toContain("waiting approval");
    expect(label).not.toContain("11111111-2222");
  });

  it("redacts sensitive fallback prompt text in recent session labels", () => {
    const label = formatSessionMenuLabel(
      {
        first_prompt_preview: "resume deploy with password=hunter2 and api_key=sk-live-secret",
        workspace_path: "D:/workspace/MMD project",
        last_status: "running",
        last_seen_at: "2026-06-02T15:18:00Z",
      },
      new Date("2026-06-03T00:00:00+08:00"),
    );

    expect(label).toContain("password=[redacted]");
    expect(label).toContain("api_key=[redacted]");
    expect(label).not.toContain("hunter2");
    expect(label).not.toContain("sk-live-secret");
  });

  it("shortens ids only for details", () => {
    expect(shortSessionId("11111111-2222-3333-4444-555555555555")).toBe("11111111...55555555");
  });

  it("builds the expected top-level menu actions", () => {
    const model = buildPetMenuModel(defaultMenuOptions);

    expect(model.map((item) => item.id)).toEqual([
      "workspace",
      "new-session",
      "send-prompt",
      "recent-sessions",
      "more-sessions",
      "separator",
      "interaction-mode",
      "notification-detail",
      "menu-language",
      "always-on-top",
      "focus-vscode",
      "sync-main-site",
      "separator",
      "close",
    ]);
    expect(model.find((item) => item.id === "focus-vscode")?.label).toBe("Open VSCode Workspace");
    expect(model.find((item) => item.id === "send-prompt")?.label).toBe("Send Prompt...");
  });

  it("shows the selected workspace and exposes a select workspace action", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      selectedWorkspacePath: "D:\\workspace\\MMD project\\.worktrees\\desktop-mmd-codex-pet",
    }).find((item) => item.id === "workspace");

    expect(workspace).toMatchObject({
      id: "workspace",
      label: "Workspace",
      submenu: [
        {
          id: "workspace:current",
          label: "Current: desktop-mmd-codex-pet",
          enabled: false,
        },
        {
          id: "workspace:select",
          label: "Select Workspace...",
          action: { type: "select-workspace" },
        },
      ],
    });
  });

  it("builds Chinese workspace labels", () => {
    const workspace = buildPetMenuModel({
      ...defaultMenuOptions,
      menuLanguage: "zh-CN",
      selectedWorkspacePath: "D:\\workspace\\MMD project",
    }).find((item) => item.id === "workspace");

    expect(workspace?.label).toBe("工作区");
    expect(workspace?.submenu?.[0]).toMatchObject({
      id: "workspace:current",
      label: "当前：MMD project",
      enabled: false,
    });
    expect(workspace?.submenu?.[1]).toMatchObject({
      id: "workspace:select",
      label: "选择工作区...",
      action: { type: "select-workspace" },
    });
  });

  it("builds a checked always-on-top checkbox that toggles to disabled", () => {
    const item = buildPetMenuModel({ ...defaultMenuOptions, alwaysOnTop: true }).find(
      (menuItem) => menuItem.id === "always-on-top",
    );

    expect(item).toEqual({
      id: "always-on-top",
      label: "Always on Top",
      type: "checkbox",
      checked: true,
      action: { type: "always-on-top", enabled: false },
    });
  });

  it("builds an unchecked Chinese always-on-top checkbox that toggles to enabled", () => {
    const item = buildPetMenuModel({
      ...defaultMenuOptions,
      menuLanguage: "zh-CN",
      alwaysOnTop: false,
    }).find((menuItem) => menuItem.id === "always-on-top");

    expect(item).toEqual({
      id: "always-on-top",
      label: "固定在顶部",
      type: "checkbox",
      checked: false,
      action: { type: "always-on-top", enabled: true },
    });
  });


  it("limits recent sessions and avoids raw uuid labels", () => {
    const sessions = Array.from({ length: 12 }, (_, index) => ({
      pet_session_id: `pet-${index}`,
      codex_session_id: `11111111-2222-3333-4444-5555555555${String(index).padStart(2, "0")}`,
      display_title: `session ${index}`,
      last_status: "running",
      last_seen_at: "2026-06-02T15:18:00Z",
    }));

    const recent = buildPetMenuModel({
      interactionMode: "window-drag",
      notificationProfile: "low",
      menuLanguage: "en",
      sessions,
      apiAvailable: true,
      now: new Date("2026-06-03T00:00:00+08:00"),
    }).find((item) => item.id === "recent-sessions");

    expect(recent?.submenu).toHaveLength(10);
    expect(recent?.submenu?.[0].label).toContain("Continue: session 0");
    expect(recent?.submenu?.[0].label).not.toContain("11111111-2222");
  });

  it("builds Chinese menu labels when language is Chinese", () => {
    const model = buildPetMenuModel({
      interactionMode: "camera-adjust",
      notificationProfile: "high",
      menuLanguage: "zh-CN",
      sessions: [
        {
          pet_session_id: "pet-1",
          display_title: "修复登录页布局",
          last_status: "waiting_approval",
          last_seen_at: "2026-06-03T10:18:00+08:00",
        },
      ],
      apiAvailable: false,
      now: new Date("2026-06-03T11:00:00+08:00"),
    });

    expect(model.find((item) => item.id === "new-session")?.label).toBe("新建 Codex 会话");
    expect(model.find((item) => item.id === "send-prompt")?.label).toBe("发送 Prompt...");
    expect(model.find((item) => item.id === "recent-sessions")?.label).toBe("最近会话");
    expect(model.find((item) => item.id === "sync-main-site")?.label).toBe("从主站同步");
    expect(model.find((item) => item.id === "focus-vscode")?.label).toBe("打开 VSCode 工作区");
    expect(model.find((item) => item.id === "menu-language")?.submenu?.map((item) => item.label)).toEqual([
      "English",
      "中文",
    ]);
    expect(model.find((item) => item.id === "recent-sessions")?.submenu?.[0].label).toContain(
      "继续：修复登录页布局",
    );
    expect(model.find((item) => item.id === "recent-sessions")?.submenu?.[0].label).toContain("等待审批");
  });
});

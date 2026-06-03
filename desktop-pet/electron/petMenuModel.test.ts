import { describe, expect, it } from "vitest";

import { buildPetMenuModel, formatSessionMenuLabel, shortSessionId } from "./petMenuModel.js";

describe("desktop pet menu model", () => {
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

  it("shortens ids only for details", () => {
    expect(shortSessionId("11111111-2222-3333-4444-555555555555")).toBe("11111111...55555555");
  });

  it("builds the expected top-level menu actions", () => {
    const model = buildPetMenuModel({
      interactionMode: "window-drag",
      notificationProfile: "medium",
      sessions: [],
      apiAvailable: true,
      now: new Date("2026-06-03T00:00:00+08:00"),
    });

    expect(model.map((item) => item.id)).toEqual([
      "new-session",
      "recent-sessions",
      "more-sessions",
      "separator",
      "interaction-mode",
      "notification-detail",
      "focus-vscode",
      "retry-api",
      "separator",
      "close",
    ]);
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
      sessions,
      apiAvailable: true,
      now: new Date("2026-06-03T00:00:00+08:00"),
    }).find((item) => item.id === "recent-sessions");

    expect(recent?.submenu).toHaveLength(10);
    expect(recent?.submenu?.[0].label).toContain("Continue: session 0");
    expect(recent?.submenu?.[0].label).not.toContain("11111111-2222");
  });
});

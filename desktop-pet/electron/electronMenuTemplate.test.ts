import { describe, expect, it, vi } from "vitest";

import { toElectronMenuTemplate } from "./electronMenuTemplate.js";
import { buildPetMenuModel } from "./petMenuModel.js";

describe("desktop pet Electron menu template", () => {
  it("marks model items with children as submenu menu items", () => {
    const template = toElectronMenuTemplate(
      buildPetMenuModel({
        interactionMode: "window-drag",
        notificationProfile: "medium",
        menuLanguage: "en",
        sessions: [],
        apiAvailable: true,
        now: new Date("2026-06-03T00:00:00+08:00"),
      }),
      vi.fn(),
    );

    const interaction = template.find((item) => item.label === "Interaction Mode");
    const notification = template.find((item) => item.label === "Notification Detail");
    const language = template.find((item) => item.label === "Language / 语言");

    expect(interaction?.type).toBe("submenu");
    expect(notification?.type).toBe("submenu");
    expect(language?.type).toBe("submenu");
    expect(interaction?.submenu?.[0]?.type).toBe("radio");
  });

  it("keeps leaf menu items normal and clickable", () => {
    const onAction = vi.fn();
    const template = toElectronMenuTemplate(
      [{ id: "sync-main-site", label: "Sync from Main Site", action: { type: "sync-main-site" } }],
      onAction,
    );

    expect(template[0].type).toBe("normal");
    template[0].click?.();
    expect(onAction).toHaveBeenCalledWith({ type: "sync-main-site" });
  });
});

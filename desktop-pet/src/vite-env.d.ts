/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopPet: {
      runtimeInfo: () => Promise<{ apiBaseUrl: string }>;
      menu: {
        openContextMenu: () => Promise<boolean>;
        onAction: (callback: (action: DesktopPetMenuAction) => void) => () => void;
      };
      notificationProfile: {
        get: () => Promise<"low" | "medium" | "high">;
      };
      interactionMode: {
        get: () => Promise<"window-drag" | "camera-adjust">;
        set: (mode: "window-drag" | "camera-adjust") => Promise<"window-drag" | "camera-adjust">;
        onChanged: (callback: (mode: "window-drag" | "camera-adjust") => void) => () => void;
      };
    };
  }
}

type DesktopPetMenuAction =
  | { type: "new-session" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions" }
  | { type: "notification-detail"; profile: "low" | "medium" | "high" }
  | { type: "focus-vscode" }
  | { type: "retry-api" };

export {};

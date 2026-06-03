/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopPet: {
      runtimeInfo: () => Promise<{ apiBaseUrl: string }>;
      interactionMode: {
        get: () => Promise<"window-drag" | "camera-adjust">;
        set: (mode: "window-drag" | "camera-adjust") => Promise<"window-drag" | "camera-adjust">;
        onChanged: (callback: (mode: "window-drag" | "camera-adjust") => void) => () => void;
      };
      windowDrag: {
        start: () => Promise<boolean>;
        move: () => Promise<{ x: number; y: number } | null>;
        end: () => Promise<boolean>;
      };
    };
  }
}

export {};

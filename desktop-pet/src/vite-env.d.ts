/// <reference types="vite/client" />

declare global {
  interface Window {
    desktopPet: {
      runtimeInfo: () => Promise<{ apiBaseUrl: string; apiRuntimeStatus: DesktopPetApiRuntimeStatus | null }>;
      apiRuntime: {
        get: () => Promise<DesktopPetApiRuntimeStatus | null>;
        retry: () => Promise<DesktopPetApiRuntimeStatus | null>;
        onChanged: (callback: (status: DesktopPetApiRuntimeStatus | null) => void) => () => void;
      };
      menu: {
        openContextMenu: (position?: { x: number; y: number }) => Promise<boolean>;
        onAction: (callback: (action: DesktopPetMenuAction) => void) => () => void;
      };
      windowDrag: {
        start: () => void;
        move: () => void;
        end: () => void;
      };
      notificationProfile: {
        get: () => Promise<"low" | "medium" | "high">;
      };
      sessions: {
        restore: (petSessionId: string) => Promise<boolean>;
      };
      prompt: {
        send: (prompt: string) => Promise<boolean>;
      };
      vscode: {
        focus: () => Promise<boolean>;
      };
      codexStatus: {
        get: () => Promise<DesktopPetCodexStatus>;
        onChanged: (callback: (status: DesktopPetCodexStatus) => void) => () => void;
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
  | { type: "select-workspace" }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: DesktopPetSession[] }
  | { type: "notification-detail"; profile: "low" | "medium" | "high" }
  | { type: "menu-language"; language: "en" | "zh-CN" }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" };

type DesktopPetCodexStatus = {
  state:
    | "idle"
    | "starting"
    | "launched"
    | "resuming"
    | "running"
    | "command_running"
    | "file_changed"
    | "waiting_approval"
    | "completed"
    | "failed"
    | "disconnected"
    | "vscode-opened";
  workspacePath?: string;
  sessionTitle?: string;
  codexSessionId?: string;
  error?: string;
  updatedAt?: string;
};

type DesktopPetApiRuntimeStatus = {
  state: "available" | "unavailable";
  available: boolean;
  apiBaseUrl: string;
  healthUrl: string;
  attempts: number;
  started: boolean;
  checkedAt: string;
  autostart: {
    enabled: boolean;
    attempted: boolean;
    reason?: "disabled" | "missing_command" | "spawn_failed";
    command?: string;
    error?: string;
  };
  logPaths?: {
    stdout: string;
    stderr: string;
  };
  statusCode?: number;
  reason?: "fetch_failed" | "bad_status";
  error?: string;
};

type DesktopPetSession = {
  pet_session_id?: string;
  codex_session_id?: string;
  display_title?: string | null;
  first_prompt_preview?: string | null;
  last_summary?: string | null;
  workspace_path?: string | null;
  last_status?: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
};

export {};

type MenuAction =
  | { type: "select-workspace" }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: unknown[] }
  | { type: "interaction-mode"; mode: "window-drag" | "camera-adjust" }
  | { type: "notification-detail"; profile: "low" | "medium" | "high" }
  | { type: "menu-language"; language: "en" | "zh-CN" }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" };

const PROFILE_LABELS: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function workspaceLabel(workspacePath: string): string {
  const parts = workspacePath.split(/[\\/]/).filter(Boolean);
  return parts.at(-1) || "workspace";
}

export function describeMenuActionResult(action: MenuAction): string {
  switch (action.type) {
    case "notification-detail":
      return `Notification detail: ${PROFILE_LABELS[action.profile]}`;
    case "sync-main-site":
      return "Syncing from main site...";
    case "menu-language":
      return action.language === "zh-CN" ? "菜单语言：中文" : "Menu language: English";
    case "always-on-top":
      return action.enabled ? "Always on top enabled" : "Always on top disabled";
    case "select-workspace":
      return "Selecting Codex workspace...";
    case "workspace-selected":
      return `Workspace selected: ${workspaceLabel(action.workspacePath)}`;
    case "new-session":
      return "Opening VSCode workspace and starting Codex...";
    case "send-prompt":
      return "Preparing Codex prompt...";
    case "prompt-sent":
      return "Prompt sent to VSCode terminal";
    case "restore-session":
      return "Opening VSCode workspace and resuming Codex...";
    case "more-sessions":
      return "Showing Codex sessions...";
    case "interaction-mode":
      return action.mode === "camera-adjust"
        ? "Interaction mode: Adjust Camera"
        : "Interaction mode: Drag Whole App";
    case "focus-vscode":
      return "Opening VSCode workspace...";
  }
}

export function describeMainSiteSyncResult(modelLabel: string | null | undefined, renderPipeline: string): string {
  return `Synced: ${modelLabel?.trim() || "no model"} · ${renderPipeline}`;
}

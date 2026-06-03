type MenuAction =
  | { type: "new-session" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions" }
  | { type: "notification-detail"; profile: "low" | "medium" | "high" }
  | { type: "menu-language"; language: "en" | "zh-CN" }
  | { type: "focus-vscode" }
  | { type: "retry-api" };

const PROFILE_LABELS: Record<"low" | "medium" | "high", string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function describeMenuActionResult(action: MenuAction): string {
  switch (action.type) {
    case "notification-detail":
      return `Notification detail: ${PROFILE_LABELS[action.profile]}`;
    case "retry-api":
      return "Retrying API...";
    case "menu-language":
      return action.language === "zh-CN" ? "菜单语言：中文" : "Menu language: English";
    case "new-session":
      return "New Codex session is not wired yet";
    case "restore-session":
      return "Codex session restore is not wired yet";
    case "more-sessions":
      return "More sessions view is not wired yet";
    case "focus-vscode":
      return "VSCode focus is not wired yet";
  }
}

import type { PetInteractionMode } from "./interactionMode.js";

export const NOTIFICATION_PROFILES = ["low", "medium", "high"] as const;
export const MENU_LANGUAGES = ["en", "zh-CN"] as const;

export type NotificationProfile = (typeof NOTIFICATION_PROFILES)[number];
export type MenuLanguage = (typeof MENU_LANGUAGES)[number];

export type PetMenuSession = {
  pet_session_id?: string;
  codex_session_id?: string;
  workspace_id?: string | null;
  display_title?: string | null;
  first_prompt_preview?: string | null;
  last_summary?: string | null;
  workspace_path?: string | null;
  codex_home?: string | null;
  last_status?: string | null;
  launch_mode?: string | null;
  remote_url?: string | null;
  app_server_pid?: number | null;
  app_server_port?: number | null;
  metadata?: Record<string, unknown> | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
};

export type PetMenuAction =
  | { type: "select-workspace" }
  | { type: "workspace-selected"; workspacePath: string }
  | { type: "new-session" }
  | { type: "send-prompt" }
  | { type: "prompt-sent" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions"; sessions?: PetMenuSession[] }
  | { type: "interaction-mode"; mode: PetInteractionMode }
  | { type: "notification-detail"; profile: NotificationProfile }
  | { type: "menu-language"; language: MenuLanguage }
  | { type: "always-on-top"; enabled: boolean }
  | { type: "focus-vscode" }
  | { type: "sync-main-site" }
  | { type: "close" };

export type PetMenuItemModel = {
  id: string;
  label?: string;
  type?: "normal" | "separator" | "radio" | "checkbox";
  checked?: boolean;
  enabled?: boolean;
  action?: PetMenuAction;
  submenu?: PetMenuItemModel[];
};

const STATUS_LABELS: Record<MenuLanguage, Record<string, string>> = {
  en: {
    no_session: "no session",
    starting: "starting",
    running: "running",
    command_running: "running command",
    file_changed: "changed files",
    waiting_approval: "waiting approval",
    completed: "completed",
    failed: "failed",
    disconnected: "disconnected",
  },
  "zh-CN": {
    no_session: "无会话",
    starting: "启动中",
    running: "运行中",
    command_running: "命令运行中",
    file_changed: "文件已变更",
    waiting_approval: "等待审批",
    completed: "已完成",
    failed: "已失败",
    disconnected: "已断开",
  },
};

const PROFILE_LABELS: Record<MenuLanguage, Record<NotificationProfile, string>> = {
  en: {
    low: "Low",
    medium: "Medium",
    high: "High",
  },
  "zh-CN": {
    low: "低",
    medium: "中",
    high: "高",
  },
};

const MENU_LABELS: Record<
  MenuLanguage,
  {
    newSession: string;
    sendPrompt: string;
    workspace: string;
    currentWorkspace: string;
    selectWorkspace: string;
    recentSessions: string;
    noRecentSessions: string;
    moreSessions: string;
    interactionMode: string;
    dragWholeApp: string;
    adjustCamera: string;
    notificationDetail: string;
    menuLanguage: string;
    alwaysOnTop: string;
    focusVscode: string;
    syncMainSite: string;
    close: string;
    continuePrefix: string;
    unknownStatus: string;
  }
> = {
  en: {
    newSession: "New Codex Session",
    sendPrompt: "Send Prompt...",
    workspace: "Workspace",
    currentWorkspace: "Current",
    selectWorkspace: "Select Workspace...",
    recentSessions: "Recent Sessions",
    noRecentSessions: "No recent sessions",
    moreSessions: "More Sessions...",
    interactionMode: "Interaction Mode",
    dragWholeApp: "Drag Whole App",
    adjustCamera: "Adjust Camera",
    notificationDetail: "Notification Detail",
    menuLanguage: "Language / 语言",
    alwaysOnTop: "Always on Top",
    focusVscode: "Open VSCode Workspace",
    syncMainSite: "Sync from Main Site",
    close: "Close",
    continuePrefix: "Continue",
    unknownStatus: "unknown",
  },
  "zh-CN": {
    newSession: "新建 Codex 会话",
    sendPrompt: "发送 Prompt...",
    workspace: "工作区",
    currentWorkspace: "当前",
    selectWorkspace: "选择工作区...",
    recentSessions: "最近会话",
    noRecentSessions: "暂无最近会话",
    moreSessions: "更多会话...",
    interactionMode: "交互模式",
    dragWholeApp: "拖动整个窗口",
    adjustCamera: "调整相机",
    notificationDetail: "提醒精度",
    menuLanguage: "Language / 语言",
    alwaysOnTop: "固定在顶部",
    focusVscode: "打开 VSCode 工作区",
    syncMainSite: "从主站同步",
    close: "关闭",
    continuePrefix: "继续",
    unknownStatus: "未知",
  },
};

export function shortSessionId(id: string): string {
  const compact = id.replaceAll("-", "");
  if (compact.length <= 16) return compact;
  return `${compact.slice(0, 8)}...${compact.slice(-8)}`;
}

function compactText(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function redactSensitiveText(value: string): string {
  return value
    .replace(
      /\b((?:[\w.-]*?(?:token|password|passwd|pwd|secret|api[_-]?key|access[_-]?key|private[_-]?key)[\w.-]*?)\s*[:=]\s*)(["']?)[^\s"',;]+/gi,
      "$1[redacted]",
    )
    .replace(/\b(?:sk|ghp|github_pat|xox[abprs])[-_][A-Za-z0-9._-]{8,}\b/g, "[redacted]");
}

function truncateText(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const clipped = value.slice(0, maxLength - 3);
  const lastSpace = clipped.lastIndexOf(" ");
  const boundary = lastSpace >= Math.floor(maxLength * 0.62) ? lastSpace : clipped.length;
  return `${clipped.slice(0, boundary).trimEnd()}...`;
}

export function formatSessionMenuLabel(session: PetMenuSession, now = new Date(), language: MenuLanguage = "en"): string {
  const labels = MENU_LABELS[language];
  const fallbackTitle = compactText(session.first_prompt_preview) || "Codex session";
  const rawTitle = compactText(session.display_title) || fallbackTitle;
  const title = truncateText(redactSensitiveText(rawTitle), 72);
  const statusKey = String(session.last_status || "");
  const status = STATUS_LABELS[language][statusKey] || statusKey || labels.unknownStatus;
  const seen = new Date(session.last_seen_at || session.updated_at || now);
  const sameDay = seen.toDateString() === now.toDateString();
  const locale = language === "zh-CN" ? "zh-CN" : undefined;
  const time = sameDay
    ? seen.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : seen.toLocaleDateString(locale, { month: "short", day: "numeric" });
  return language === "zh-CN"
    ? `${labels.continuePrefix}：${title} · ${time} · ${status}`
    : `${labels.continuePrefix}: ${title} · ${time} · ${status}`;
}

export function normalizeNotificationProfile(value: unknown): NotificationProfile {
  return NOTIFICATION_PROFILES.includes(value as NotificationProfile) ? (value as NotificationProfile) : "medium";
}

export function normalizeMenuLanguage(value: unknown): MenuLanguage {
  return MENU_LANGUAGES.includes(value as MenuLanguage) ? (value as MenuLanguage) : "en";
}

function workspaceName(workspacePath: string | undefined): string {
  const parts = workspacePath?.split(/[\\/]/).filter(Boolean) ?? [];
  return parts.at(-1) || "workspace";
}

export function buildPetMenuModel(options: {
  interactionMode: PetInteractionMode;
  notificationProfile: NotificationProfile;
  menuLanguage: MenuLanguage;
  sessions: PetMenuSession[];
  apiAvailable: boolean;
  alwaysOnTop?: boolean;
  selectedWorkspacePath?: string;
  now?: Date;
}): PetMenuItemModel[] {
  const now = options.now ?? new Date();
  const language = normalizeMenuLanguage(options.menuLanguage);
  const labels = MENU_LABELS[language];
  const recentSessions = options.sessions.slice(0, 10);
  const alwaysOnTop = options.alwaysOnTop ?? true;
  const currentWorkspaceLabel =
    language === "zh-CN"
      ? `${labels.currentWorkspace}：${workspaceName(options.selectedWorkspacePath)}`
      : `${labels.currentWorkspace}: ${workspaceName(options.selectedWorkspacePath)}`;
  return [
    {
      id: "workspace",
      label: labels.workspace,
      submenu: [
        {
          id: "workspace:current",
          label: currentWorkspaceLabel,
          enabled: false,
        },
        {
          id: "workspace:select",
          label: labels.selectWorkspace,
          action: { type: "select-workspace" },
        },
      ],
    },
    { id: "new-session", label: labels.newSession, action: { type: "new-session" } },
    { id: "send-prompt", label: labels.sendPrompt, action: { type: "send-prompt" } },
    {
      id: "recent-sessions",
      label: labels.recentSessions,
      enabled: recentSessions.length > 0,
      submenu:
        recentSessions.length > 0
          ? recentSessions.map((session) => ({
              id: `restore-session:${session.pet_session_id || session.codex_session_id || ""}`,
              label: formatSessionMenuLabel(session, now, language),
              action: { type: "restore-session", petSessionId: String(session.pet_session_id || "") },
            }))
          : [{ id: "no-recent-sessions", label: labels.noRecentSessions, enabled: false }],
    },
    { id: "more-sessions", label: labels.moreSessions, action: { type: "more-sessions" } },
    { id: "separator", type: "separator" },
    {
      id: "interaction-mode",
      label: labels.interactionMode,
      submenu: [
        {
          id: "interaction-mode:window-drag",
          label: labels.dragWholeApp,
          type: "radio",
          checked: options.interactionMode === "window-drag",
          action: { type: "interaction-mode", mode: "window-drag" },
        },
        {
          id: "interaction-mode:camera-adjust",
          label: labels.adjustCamera,
          type: "radio",
          checked: options.interactionMode === "camera-adjust",
          action: { type: "interaction-mode", mode: "camera-adjust" },
        },
      ],
    },
    {
      id: "notification-detail",
      label: labels.notificationDetail,
      submenu: NOTIFICATION_PROFILES.map((profile) => ({
        id: `notification-detail:${profile}`,
        label: PROFILE_LABELS[language][profile],
        type: "radio",
        checked: options.notificationProfile === profile,
        action: { type: "notification-detail", profile },
      })),
    },
    {
      id: "menu-language",
      label: labels.menuLanguage,
      submenu: [
        {
          id: "menu-language:en",
          label: "English",
          type: "radio",
          checked: language === "en",
          action: { type: "menu-language", language: "en" },
        },
        {
          id: "menu-language:zh-CN",
          label: "中文",
          type: "radio",
          checked: language === "zh-CN",
          action: { type: "menu-language", language: "zh-CN" },
        },
      ],
    },
    {
      id: "always-on-top",
      label: labels.alwaysOnTop,
      type: "checkbox",
      checked: alwaysOnTop,
      action: { type: "always-on-top", enabled: !alwaysOnTop },
    },
    { id: "focus-vscode", label: labels.focusVscode, action: { type: "focus-vscode" } },
    {
      id: "sync-main-site",
      label: labels.syncMainSite,
      action: { type: "sync-main-site" },
    },
    { id: "separator", type: "separator" },
    { id: "close", label: labels.close, action: { type: "close" } },
  ];
}

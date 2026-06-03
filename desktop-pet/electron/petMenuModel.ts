import type { PetInteractionMode } from "./interactionMode.js";

export const NOTIFICATION_PROFILES = ["low", "medium", "high"] as const;

export type NotificationProfile = (typeof NOTIFICATION_PROFILES)[number];

export type PetMenuSession = {
  pet_session_id?: string;
  codex_session_id?: string;
  display_title?: string | null;
  first_prompt_preview?: string | null;
  workspace_path?: string | null;
  last_status?: string | null;
  last_seen_at?: string | null;
  updated_at?: string | null;
};

export type PetMenuAction =
  | { type: "new-session" }
  | { type: "restore-session"; petSessionId: string }
  | { type: "more-sessions" }
  | { type: "interaction-mode"; mode: PetInteractionMode }
  | { type: "notification-detail"; profile: NotificationProfile }
  | { type: "focus-vscode" }
  | { type: "retry-api" }
  | { type: "close" };

export type PetMenuItemModel = {
  id: string;
  label?: string;
  type?: "normal" | "separator" | "radio";
  checked?: boolean;
  enabled?: boolean;
  action?: PetMenuAction;
  submenu?: PetMenuItemModel[];
};

const STATUS_LABELS: Record<string, string> = {
  no_session: "no session",
  starting: "starting",
  running: "running",
  command_running: "running command",
  file_changed: "changed files",
  waiting_approval: "waiting approval",
  completed: "completed",
  failed: "failed",
  disconnected: "disconnected",
};

const PROFILE_LABELS: Record<NotificationProfile, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

export function shortSessionId(id: string): string {
  const compact = id.replaceAll("-", "");
  if (compact.length <= 16) return compact;
  return `${compact.slice(0, 8)}...${compact.slice(-8)}`;
}

export function formatSessionMenuLabel(session: PetMenuSession, now = new Date()): string {
  const fallbackTitle = session.first_prompt_preview || "Codex session";
  const title = String(session.display_title || fallbackTitle).slice(0, 48);
  const statusKey = String(session.last_status || "");
  const status = STATUS_LABELS[statusKey] || statusKey || "unknown";
  const seen = new Date(session.last_seen_at || session.updated_at || now);
  const sameDay = seen.toDateString() === now.toDateString();
  const time = sameDay
    ? seen.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : seen.toLocaleDateString([], { month: "short", day: "numeric" });
  return `Continue: ${title} · ${time} · ${status}`;
}

export function normalizeNotificationProfile(value: unknown): NotificationProfile {
  return NOTIFICATION_PROFILES.includes(value as NotificationProfile) ? (value as NotificationProfile) : "medium";
}

export function buildPetMenuModel(options: {
  interactionMode: PetInteractionMode;
  notificationProfile: NotificationProfile;
  sessions: PetMenuSession[];
  apiAvailable: boolean;
  now?: Date;
}): PetMenuItemModel[] {
  const now = options.now ?? new Date();
  const recentSessions = options.sessions.slice(0, 10);
  return [
    { id: "new-session", label: "New Codex Session", action: { type: "new-session" } },
    {
      id: "recent-sessions",
      label: "Recent Sessions",
      enabled: recentSessions.length > 0,
      submenu:
        recentSessions.length > 0
          ? recentSessions.map((session) => ({
              id: `restore-session:${session.pet_session_id || session.codex_session_id || ""}`,
              label: formatSessionMenuLabel(session, now),
              action: { type: "restore-session", petSessionId: String(session.pet_session_id || "") },
            }))
          : [{ id: "no-recent-sessions", label: "No recent sessions", enabled: false }],
    },
    { id: "more-sessions", label: "More Sessions...", action: { type: "more-sessions" } },
    { id: "separator", type: "separator" },
    {
      id: "interaction-mode",
      label: "Interaction Mode",
      submenu: [
        {
          id: "interaction-mode:window-drag",
          label: "Drag Whole App",
          type: "radio",
          checked: options.interactionMode === "window-drag",
          action: { type: "interaction-mode", mode: "window-drag" },
        },
        {
          id: "interaction-mode:camera-adjust",
          label: "Adjust Camera",
          type: "radio",
          checked: options.interactionMode === "camera-adjust",
          action: { type: "interaction-mode", mode: "camera-adjust" },
        },
      ],
    },
    {
      id: "notification-detail",
      label: "Notification Detail",
      submenu: NOTIFICATION_PROFILES.map((profile) => ({
        id: `notification-detail:${profile}`,
        label: PROFILE_LABELS[profile],
        type: "radio",
        checked: options.notificationProfile === profile,
        action: { type: "notification-detail", profile },
      })),
    },
    { id: "focus-vscode", label: "Focus VSCode Terminal", action: { type: "focus-vscode" } },
    {
      id: "retry-api",
      label: options.apiAvailable ? "Retry API" : "Retry API Connection",
      action: { type: "retry-api" },
    },
    { id: "separator", type: "separator" },
    { id: "close", label: "Close", action: { type: "close" } },
  ];
}

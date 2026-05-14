"use client";

import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createVmdPreviewInteraction,
  excludeEntryStandbyAssets,
  resolveVmdPlaybackRate,
} from "@/features/mapping/vmdPreview.js";
import { resolvePlaybackPlan } from "@/features/mapping/resolveAction.js";
import { MMDStage, type MMDStageHandle } from "@/features/stage/MMDStage";
import { CompanionCommandBar } from "./CompanionCommandBar";
import { MioModeBackground } from "./MioModeBackground";
import { CompanionRightRail, type RightPanelView } from "./CompanionRightRail";
import {
  DEFAULT_VMD_PLAYBACK_RATE,
} from "@/features/stage/builtInMotionPreferences.js";
import { getModelDisplayLabel, pickInitialModelSelection } from "@/features/stage/modelCatalog.js";
import { collectImportableVmdFiles } from "@/features/stage/vmdImportHelpers.js";
import {
  cleanupMessageServiceAdmin,
  createMotionContextExport,
  createChatSession,
  deleteChatSession,
  getLatestMotionContextExport,
  getMessageBridgeStatus,
  getOpenClawConfig,
  getOpenClawHealth,
  getMessageById,
  getResolvedMappings,
  listMessageBridgeFeishuSessions,
  listChatSessions,
  listMmdModels,
  listSessionMessages,
  listVmdAssets,
  postSessionMessage,
  patchMessageBridgeSettings,
  putOpenClawConfig,
  regenerateMessageTts,
  setDefaultMessageBridgeBinding,
  sessionVoiceWebSocketUrl,
  updateChatSession,
  updateVmdAsset,
  uploadVmdAsset,
} from "@/lib/api";
import { AudioQueue } from "@/lib/realtimeVoiceQueue.js";
import { clearSession, loadSession, saveSession } from "@/lib/session";
import { DEFAULT_TTS_MODE, playServerTtsAudio } from "@/lib/ttsPlayback.js";
import type {
  ChatMessage,
  MappingConfig,
  MessageServiceCleanupResult,
  MessageServiceMessage,
  MessageServiceSession,
  MessageBridgeExternalSession,
  MessageBridgeStatus,
  MotionContextExport,
  MmdCameraSnapshot,
  MmdModelAsset,
  OpenClawConfig,
  OpenClawHealthStatus,
  RealtimeVoiceFallbackMode,
  RealtimeVoiceStatus,
  RenderPipeline,
  UserSession,
  VmdAsset,
} from "@/lib/types";

type InteractionStep = {
  template: string;
  action: string;
  durationMs: number;
  intensity: number;
};

type InteractionState = {
  emotion: string;
  action: string;
  mode: "procedural" | "vmd";
  vmdUrl: string;
  vmdLoopUrls?: string[];
  vmdLoopEmotionByUrl?: Record<string, string>;
  standbyVmdUrl?: string;
  loopGapMs?: number;
  loopMode?: "random" | "sequential";
  lockLowerBody?: boolean;
  disableCrossfade?: boolean;
  playbackRate?: number;
  sequence: InteractionStep[];
};

type InteractionSource = "default" | "autoplay" | "manual-preview" | "chat";
type ToastState = { id: number; message: string } | null;
type ChatMessageTts = NonNullable<ChatMessage["tts"]>;
type OpenClawDraft = {
  base_url: string;
  token: string;
  token_configured: boolean;
  agent_id: string;
  model: string;
  message_channel: string;
  proxy_url: string;
  verify_ssl: boolean;
  timeout_seconds: string;
};
type RealtimeVoiceServerEvent = {
  type: "queued" | "synthesis_started" | "audio_ready" | "done" | "rejected" | "error" | "cancelled";
  session_id?: string;
  message_id?: string;
  job_id?: string;
  queue_position?: number;
  sequence?: number;
  text?: string;
  audio_url?: string;
  duration?: number | null;
  elapsed_seconds?: number | null;
  reason?: string;
  fallback?: string;
  detail?: string;
};
type RealtimeAudioQueue = {
  enqueue: (chunk: {
    jobId: string;
    messageId?: string;
    sequence: number;
    url: string;
    text?: string;
    duration?: number | null;
  }) => void;
  clear: (options?: { resetHistory?: boolean }) => void;
  fallbackForJobError: (jobId: string) => RealtimeVoiceFallbackMode;
  hasPlayedChunk: (jobId: string) => boolean;
};
type RealtimeAudioQueueCtor = new (options?: {
  AudioCtor?: typeof Audio;
  onError?: (event: { jobId: string; messageId?: string; fallback: RealtimeVoiceFallbackMode; error?: Error }) => void;
  onChunkStart?: (entry: { jobId: string; messageId?: string }) => void;
  onChunkEnd?: (entry: { jobId: string; messageId?: string }) => void;
}) => RealtimeAudioQueue;

const SPRITE = "/images/sprite-sliced";
const MESSAGE_BRIDGE_POLL_INTERVAL_MS = 2500;
const DEFAULT_MODEL_RELATIVE_PATH = "优菈.pmx";
const DEFAULT_ASSISTANT_COPY =
  "\u6211\u7406\u89e3\u4f60\u7684\u9700\u6c42\u4e86\uff5e\n\u6b63\u5728\u5e2e\u4f60\u62c6\u89e3\u4efb\u52a1\u5e76\u89c4\u5212\u6b65\u9aa4\uff01";
const INPUT_LABEL =
  "\u8f93\u5165\u4f60\u7684\u6307\u4ee4 / \u4efb\u52a1 / \u95ee\u9898...\uff08Enter \u53d1\u9001\uff0cShift + Enter \u6362\u884c\uff09";

function normalizeRenderPipeline(value?: string): RenderPipeline {
  if (value === "classic" || value === "hero-shot" || value === "genshin" || value === "mio-reference") return value;
  return "mio-reference";
}

const navIcons: ReadonlyArray<{ key: "menu" | "chat" | "tasks" | "tools" | "memory" | "skills"; label: string; view: RightPanelView }> = [
  { key: "menu", label: "\u83dc\u5355", view: "overview" },
  { key: "chat", label: "\u5bf9\u8bdd", view: "chat" },
  { key: "tasks", label: "\u4efb\u52a1", view: "tasks" },
  { key: "tools", label: "\u5de5\u5177", view: "tools" },
  { key: "memory", label: "\u8bb0\u5fc6", view: "memory" },
  { key: "skills", label: "\u80fd\u529b", view: "skills" },
] as const;

function renderSidebarIcon(icon: (typeof navIcons)[number]["key"] | "settings"): ReactNode {
  switch (icon) {
    case "menu":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M4 5.25h12M4 10h12M4 14.75h12" />
        </svg>
      );
    case "chat":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M5.25 5.5h9.5a2.25 2.25 0 0 1 2.25 2.25v4.5a2.25 2.25 0 0 1-2.25 2.25H9l-3.5 2.5v-2.5H5.25A2.25 2.25 0 0 1 3 12.25v-4.5A2.25 2.25 0 0 1 5.25 5.5Z" />
          <path d="M6.8 10h.01M10 10h.01M13.2 10h.01" />
        </svg>
      );
    case "tasks":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M7 4.75h6" />
          <path d="M7.25 3h5.5a1 1 0 0 1 1 1v1.25h1A2.25 2.25 0 0 1 17 7.5v8.25A2.25 2.25 0 0 1 14.75 18h-9.5A2.25 2.25 0 0 1 3 15.75V7.5a2.25 2.25 0 0 1 2.25-2.25h1V4a1 1 0 0 1 1-1Z" />
          <path d="M6.75 9.5h6.5M6.75 12.5h4.75" />
        </svg>
      );
    case "tools":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M10 3.2l5.85 3.35v6.9L10 16.8l-5.85-3.35v-6.9L10 3.2Z" />
          <path d="M10 3.2v6.8m5.85-3.45L10 10M4.15 6.55 10 10" />
        </svg>
      );
    case "memory":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M7.2 5.25A2.95 2.95 0 0 0 4.25 8.2v3.6a2.95 2.95 0 0 0 2.95 2.95h.8v1.1a.65.65 0 0 0 1.03.52l1.94-1.62h1.83a2.95 2.95 0 0 0 2.95-2.95V8.2a2.95 2.95 0 0 0-2.95-2.95H7.2Z" />
          <path d="M7 10a3 3 0 0 1 6 0M10 7.75v4.5M7.75 10h4.5" />
        </svg>
      );
    case "skills":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M11.1 3.6 6.7 10.1h3l-1 6.3 4.6-7h-3.1l.9-5.8Z" />
        </svg>
      );
    case "settings":
      return (
        <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
          <path d="M10 3.7v1.45M10 14.85v1.45M5.15 10H3.7M16.3 10h-1.45" />
          <circle cx="10" cy="10" r="2.8" />
          <path d="M6.15 6.15 5.1 5.1M14.9 14.9l-1.05-1.05M13.85 6.15 14.9 5.1M5.1 14.9l1.05-1.05" />
        </svg>
      );
    default:
      return null;
  }
}

const nextSteps = [
  "\u751f\u6210\u9700\u6c42\u6587\u6863\u5927\u7eb2",
  "\u7ade\u54c1\u8c03\u7814\u4e0e\u5206\u6790",
  "\u8f93\u51fa\u521d\u7248\u9700\u6c42\u6587\u6863",
];

const memoryNotes = [
  "\u4f60\u504f\u597d\u7ed3\u6784\u5316\u8868\u8fbe\u65b9\u5f0f",
  "\u5e38\u7528\u5de5\u5177\uff1aNotion / VS Code",
  "\u5173\u6ce8\u70b9\uff1a\u6548\u7387\u3001\u53ef\u6269\u5c55\u6027\u3001UI \u8bbe\u8ba1",
];

const traceRows = [
  ["POST", "/v1/chat/completions", "200", "2.1s"],
  ["GET", "/v1/search", "200", "1.2s"],
  ["POST", "/v1/plan", "200", "3.4s"],
  ["POST", "/v1/memory/save", "200", "0.8s"],
  ["GET", "/v1/tools/list", "200", "0.6s"],
] as const;

const renderPipelineOptions: { value: RenderPipeline; label: string; description: string }[] = [
  { value: "mio-reference", label: "MIO Reference", description: "设计稿星海舞台" },
  { value: "classic", label: "Classic", description: "\u7a33\u5b9a MMD \u821e\u53f0" },
  { value: "hero-shot", label: "Hero Shot", description: "\u7535\u5f71\u611f\u6784\u56fe" },
  { value: "genshin", label: "Genshin", description: "Project2 \u900f\u660e\u98ce\u683c" },
];

const EMOTION_SLOTS = ["neutral", "happy", "sad", "thinking", "excited", "caring"] as const;

function createDefaultInteractionState(): InteractionState {
  return {
    emotion: "neutral",
    action: "idle",
    mode: "procedural",
    vmdUrl: "",
    vmdLoopUrls: [],
    vmdLoopEmotionByUrl: {},
    standbyVmdUrl: "",
    loopGapMs: 0,
    loopMode: "random",
    playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
    sequence: [],
  };
}

function createOpenClawDraft(config?: OpenClawConfig | null): OpenClawDraft {
  return {
    base_url: config?.base_url || "http://127.0.0.1:18789",
    token: "",
    token_configured: Boolean(config?.token_configured),
    agent_id: config?.agent_id || "main",
    model: config?.model || "",
    message_channel: config?.message_channel || "feishu",
    proxy_url: config?.proxy_url || "",
    verify_ssl: config?.verify_ssl ?? true,
    timeout_seconds: String(config?.timeout_seconds ?? 15),
  };
}

function makeHistory(messages: ChatMessage[]) {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content }));
}

function createMessageId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
}

function mapServerTtsToChatTts(messageTts?: MessageServiceMessage["tts"] | null): ChatMessage["tts"] | undefined {
  if (!messageTts) return undefined;
  return {
    id: messageTts.id,
    status: messageTts.status,
    mode: "server",
    provider: messageTts.provider,
    version: messageTts.version,
    mediaType: messageTts.media_type || undefined,
    remoteAudioUrl: messageTts.remote_audio_url || undefined,
    proxyAudioUrl: messageTts.proxy_audio_url || undefined,
    taskId: messageTts.task_id || undefined,
    error: messageTts.error || undefined,
  };
}

function mapServerMessageToChatMessage(message: MessageServiceMessage): ChatMessage {
  return {
    id: message.id,
    role: message.role,
    content: message.content,
    createdAt: message.created_at,
    traceId: message.trace_id || undefined,
    tts: mapServerTtsToChatTts(message.tts),
  };
}

function formatMessageBridgeSessionLabel(item: MessageBridgeExternalSession): string {
  const name = item.external_display_name || "Feishu";
  const keyTail = item.external_session_key.split(":").slice(-2).join(":");
  const isTargetDirect =
    item.external_session_key === "agent:main:feishu:direct:ou_229011826b88e09badbbb6f43ad38ba3";
  const channelKind = item.external_session_key.includes(":direct:") ? "direct" : "session";
  return `${isTargetDirect ? "[当前直连] " : ""}${name} · ${channelKind} · ${keyTail}`;
}

function buildFavoriteVmdCameraKey(pipeline: RenderPipeline, modelPath: string, assetId: string) {
  return `${pipeline}::${encodeURIComponent(modelPath)}::${encodeURIComponent(assetId)}`;
}

export default function CompanionPage() {
  const router = useRouter();
  const stageRef = useRef<MMDStageHandle | null>(null);
  const serverAudioRef = useRef<HTMLAudioElement | null>(null);
  const serverAudioCleanupRef = useRef<(() => void) | null>(null);
  const ignoreNextStageCompletionResetRef = useRef(false);
  const pendingTtsPollersRef = useRef<Set<string>>(new Set());
  const voiceSocketRef = useRef<WebSocket | null>(null);
  const audioQueueRef = useRef<RealtimeAudioQueue | null>(null);
  const realtimeVoiceJobMessageRef = useRef<Map<string, string>>(new Map());
  const messagesRef = useRef<ChatMessage[]>([]);
  const sessionRef = useRef<UserSession | null>(null);
  const chatSessionIdRef = useRef("");
  const [session, setSession] = useState<UserSession | null>(null);
  const [chatSessions, setChatSessions] = useState<MessageServiceSession[]>([]);
  const [chatSessionId, setChatSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [chatBootstrapping, setChatBootstrapping] = useState(false);
  const [sessionBusy, setSessionBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState<ToastState>(null);
  const [interaction, setInteraction] = useState<InteractionState>(createDefaultInteractionState);
  const [mappings, setMappings] = useState<Record<string, MappingConfig>>({});
  const [assets, setAssets] = useState<VmdAsset[]>([]);
  const [models, setModels] = useState<MmdModelAsset[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsMode, setTtsMode] = useState<"browser" | "server">(DEFAULT_TTS_MODE as "browser" | "server");
  const [speaking, setSpeaking] = useState(false);
  const [activeTtsMessageId, setActiveTtsMessageId] = useState("");
  const [realtimeVoiceStatus, setRealtimeVoiceStatus] = useState<RealtimeVoiceStatus>("idle");
  const [backgroundActivityPulse, setBackgroundActivityPulse] = useState(0);
  const [renderPipeline, setRenderPipeline] = useState<RenderPipeline>("mio-reference");
  const [isAdvancedPanelOpen, setIsAdvancedPanelOpen] = useState(false);
  const [advancedTab, setAdvancedTab] = useState<"library" | "favorites">("library");
  const [advancedSlot, setAdvancedSlot] = useState<(typeof EMOTION_SLOTS)[number]>("happy");
  const [advancedFavoriteSlotFilter, setAdvancedFavoriteSlotFilter] = useState<"all" | (typeof EMOTION_SLOTS)[number]>(
    "all",
  );
  const [advancedPlaybackRate, setAdvancedPlaybackRate] = useState("1");
  const [advancedBusy, setAdvancedBusy] = useState(false);
  const [advancedError, setAdvancedError] = useState("");
  const [advancedMessage, setAdvancedMessage] = useState("");
  const [latestMotionContextExport, setLatestMotionContextExport] = useState<MotionContextExport | null>(null);
  const [cameraEditMode, setCameraEditMode] = useState(false);
  const [activeVmdAssetId, setActiveVmdAssetId] = useState("");
  const [renameTarget, setRenameTarget] = useState<VmdAsset | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [interactionSource, setInteractionSource] = useState<InteractionSource>("default");
  const [pendingAutoResume, setPendingAutoResume] = useState(false);
  const [isCompactHud, setIsCompactHud] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isRightRailCollapsed, setIsRightRailCollapsed] = useState(true);
  const [activeRightPanelView, setActiveRightPanelView] = useState<RightPanelView>("overview");
  const [isOpenClawSettingsOpen, setIsOpenClawSettingsOpen] = useState(false);
  const [openClawDraft, setOpenClawDraft] = useState<OpenClawDraft>(createOpenClawDraft);
  const [openClawSavedConfig, setOpenClawSavedConfig] = useState<OpenClawConfig | null>(null);
  const [openClawHealth, setOpenClawHealth] = useState<OpenClawHealthStatus | null>(null);
  const [openClawLoading, setOpenClawLoading] = useState(false);
  const [openClawSaving, setOpenClawSaving] = useState(false);
  const [openClawTesting, setOpenClawTesting] = useState(false);
  const [openClawError, setOpenClawError] = useState("");
  const [openClawMessage, setOpenClawMessage] = useState("");
  const [messageBridgeStatus, setMessageBridgeStatus] = useState<MessageBridgeStatus | null>(null);
  const [messageBridgeSessions, setMessageBridgeSessions] = useState<MessageBridgeExternalSession[]>([]);
  const [messageBridgeSelectedSessionKey, setMessageBridgeSelectedSessionKey] = useState("");
  const [messageBridgeLoading, setMessageBridgeLoading] = useState(false);
  const [messageBridgeSaving, setMessageBridgeSaving] = useState(false);
  const [cleanupBusy, setCleanupBusy] = useState(false);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    chatSessionIdRef.current = chatSessionId;
  }, [chatSessionId]);

  useEffect(() => {
    const saved = loadSession();
    const normalizedPipeline: RenderPipeline = "mio-reference";
    const normalizedSession =
      saved && saved.renderPipeline !== normalizedPipeline
        ? { ...saved, renderPipeline: normalizedPipeline }
        : saved;
    setSession(normalizedSession ?? null);
    setRenderPipeline(normalizedPipeline);
    if (normalizedSession && normalizedSession !== saved) {
      saveSession(normalizedSession);
    }
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    setChatBootstrapping(true);

    (async () => {
      try {
        const [mappingRows, assetRows, modelRows, sessionRows] = await Promise.all([
          getResolvedMappings(session.userId),
          listVmdAssets(session.userId),
          listMmdModels(),
          listChatSessions(session.userId),
        ]);
        if (cancelled) return;

        setMappings(mappingRows);
        setAssets(assetRows);
        setModels(modelRows);
        setChatSessions(sessionRows);
        setSelectedModelPath((current) => {
          if (current && modelRows.some((item) => item.relative_path === current)) {
            return current;
          }
          const preferred =
            modelRows.find((item) => item.relative_path.includes(DEFAULT_MODEL_RELATIVE_PATH)) ||
            pickInitialModelSelection(modelRows, DEFAULT_MODEL_RELATIVE_PATH);
          return preferred?.relative_path || "";
        });

        let activeSession =
          sessionRows.find((item) => item.id === session.activeChatSessionId) ||
          sessionRows[0] ||
          null;
        if (!activeSession) {
          activeSession = await createChatSession(session.userId);
          if (cancelled) return;
        }

        const nextSessionId = activeSession.id;
        setChatSessionId(nextSessionId);
        if (session.activeChatSessionId !== nextSessionId) {
          const nextUserSession = { ...session, activeChatSessionId: nextSessionId };
          setSession(nextUserSession);
          saveSession(nextUserSession);
        }

        const serverMessages = await listSessionMessages(session.userId, nextSessionId);
        if (cancelled) return;
        setMessages(serverMessages.map(mapServerMessageToChatMessage));
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "会话初始化失败。");
      } finally {
        if (!cancelled) {
          setChatBootstrapping(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session]);

  function handleRightPanelViewChange(view: RightPanelView) {
    setActiveRightPanelView(view);
    setIsRightRailCollapsed(false);
  }

  const loadOpenClawConfig = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!session) return;
      if (!silent) {
        setOpenClawLoading(true);
        setOpenClawError("");
        setOpenClawMessage("");
        setOpenClawHealth(null);
      }
      try {
        const config = await getOpenClawConfig(session.userId);
        setOpenClawSavedConfig(config);
        setOpenClawDraft(createOpenClawDraft(config));
      } catch (err) {
        if (!silent) {
          setOpenClawError(err instanceof Error ? err.message : "OpenClaw 配置读取失败。");
        }
      } finally {
        if (!silent) {
          setOpenClawLoading(false);
        }
      }
    },
    [session],
  );

  const loadMessageBridgeStatus = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!session) return;
      if (!silent) {
        setMessageBridgeLoading(true);
      }
      try {
        const [status, sessions] = await Promise.all([
          getMessageBridgeStatus(session.userId),
          listMessageBridgeFeishuSessions(session.userId),
        ]);
        setMessageBridgeStatus(status);
        setMessageBridgeSessions(sessions);
        setMessageBridgeSelectedSessionKey(status.binding?.external_session_key || sessions[0]?.external_session_key || "");
      } catch (err) {
        setMessageBridgeStatus(null);
        setMessageBridgeSessions([]);
        if (!silent) {
          setOpenClawError(err instanceof Error ? err.message : "消息桥状态读取失败。");
        }
      } finally {
        if (!silent) {
          setMessageBridgeLoading(false);
        }
      }
    },
    [session],
  );

  const loadLatestMotionContextExport = useCallback(async () => {
    if (!session || !selectedModelPath) {
      setLatestMotionContextExport(null);
      return;
    }
    try {
      const exported = await getLatestMotionContextExport(session.userId, selectedModelPath);
      setLatestMotionContextExport(exported);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Motion context export load failed.";
      if (/not found/i.test(message)) {
        setLatestMotionContextExport(null);
        return;
      }
      throw err;
    }
  }, [selectedModelPath, session]);

  useEffect(() => {
    if (!session) return;
    void loadOpenClawConfig({ silent: true });
  }, [loadOpenClawConfig, session]);

  useEffect(() => {
    if (!isOpenClawSettingsOpen || !session) return;
    void loadOpenClawConfig();
    void loadMessageBridgeStatus();
  }, [isOpenClawSettingsOpen, loadMessageBridgeStatus, loadOpenClawConfig, session]);

  useEffect(() => {
    if (!session || !chatSessionId || !messageBridgeStatus?.enabled) return;
    const timer = window.setInterval(() => {
      void refreshActiveSessionMessages({ driveBridgeMessages: true }).catch(() => {
        // Polling is best-effort; explicit user actions still surface errors.
      });
      void loadMessageBridgeStatus({ silent: true });
    }, MESSAGE_BRIDGE_POLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [chatSessionId, loadMessageBridgeStatus, messageBridgeStatus?.enabled, session]);

  useEffect(() => {
    if (!isAdvancedPanelOpen) return;
    void loadLatestMotionContextExport().catch(() => {
      setAdvancedError("Motion context export load failed.");
    });
  }, [isAdvancedPanelOpen, loadLatestMotionContextExport]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(max-width: 1180px), (max-height: 860px)");
    const syncCompact = (matches: boolean) => {
      setIsCompactHud(matches);
      setIsRightRailCollapsed(!matches);
    };

    syncCompact(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => syncCompact(event.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timeoutId = window.setTimeout(() => {
      setToast((current) => (current?.id === toast.id ? null : current));
    }, 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const latestReadyAssistant = [...messages].reverse().find((item) => item.role === "assistant");
    if (latestReadyAssistant?.tts?.status !== "ready" || !latestReadyAssistant.tts.remoteAudioUrl) return;
    const audio = new Audio();
    audio.preload = "metadata";
    audio.src = latestReadyAssistant.tts.remoteAudioUrl;
    return () => {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
  }, [messages]);

  useEffect(() => {
    if (!session) return;
    const pendingMessages = messages.filter(
      (message) => message.role === "assistant" && message.id && message.tts?.status === "pending",
    );
    for (const message of pendingMessages) {
      const messageId = message.id as string;
      if (pendingTtsPollersRef.current.has(messageId)) continue;
      pendingTtsPollersRef.current.add(messageId);
      void (async () => {
        try {
          for (let attempt = 0; attempt < 10; attempt += 1) {
            await new Promise((resolve) => window.setTimeout(resolve, 1200));
            const refreshed = await refreshMessageFromServer(messageId);
            const status = refreshed?.tts?.status;
            if (!status || status === "ready" || status === "failed" || status === "expired") {
              break;
            }
          }
        } finally {
          pendingTtsPollersRef.current.delete(messageId);
        }
      })();
    }
  }, [messages, session]);

  const assetIndex = useMemo(() => {
    const next: Record<string, VmdAsset> = {};
    for (const item of assets) {
      next[item.asset_id] = item;
    }
    return next;
  }, [assets]);

  const recentVmdAssets = useMemo(() => {
    return [...assets].sort((left, right) => {
      const leftTime = Date.parse(left.created_at || "") || 0;
      const rightTime = Date.parse(right.created_at || "") || 0;
      return rightTime - leftTime;
    });
  }, [assets]);

  const visibleRecentVmdAssets = useMemo(() => {
    return excludeEntryStandbyAssets(recentVmdAssets);
  }, [recentVmdAssets]);

  const selectedModel = useMemo(() => {
    return (
      models.find((item) => item.relative_path === selectedModelPath) ||
      pickInitialModelSelection(models, DEFAULT_MODEL_RELATIVE_PATH)
    );
  }, [models, selectedModelPath]);

  const currentModelFavoriteAssets = useMemo(() => {
    if (!selectedModel?.relative_path) return [];
    return visibleRecentVmdAssets.filter(
      (asset) => asset.is_favorite && asset.favorite_model_relative_path === selectedModel.relative_path,
    );
  }, [selectedModel?.relative_path, visibleRecentVmdAssets]);

  const currentModelAutoplayAssets = useMemo(() => {
    if (!selectedModel?.relative_path) return [];
    return recentVmdAssets.filter(
      (asset) => asset.is_favorite && asset.favorite_model_relative_path === selectedModel.relative_path,
    );
  }, [selectedModel?.relative_path, recentVmdAssets]);

  const filteredFavoriteAssets = useMemo(() => {
    if (advancedFavoriteSlotFilter === "all") return currentModelFavoriteAssets;
    return currentModelFavoriteAssets.filter((asset) => asset.slot === advancedFavoriteSlotFilter);
  }, [advancedFavoriteSlotFilter, currentModelFavoriteAssets]);

  const autoFavoriteInteraction = useMemo<InteractionState | null>(() => {
    return buildAutoFavoriteInteraction(currentModelAutoplayAssets) as InteractionState | null;
  }, [currentModelAutoplayAssets]);

  const autoplayResumeInteraction = useMemo<InteractionState | null>(() => {
    return buildAutoplayResumeInteraction(currentModelAutoplayAssets) as InteractionState | null;
  }, [currentModelAutoplayAssets]);

  const activeFavoriteVmdAsset = useMemo(() => {
    if (!activeVmdAssetId) return null;
    return currentModelFavoriteAssets.find((asset) => asset.asset_id === activeVmdAssetId) || null;
  }, [activeVmdAssetId, currentModelFavoriteAssets]);

  const activeFavoriteVmdCameraKey =
    activeFavoriteVmdAsset && selectedModel?.relative_path
      ? buildFavoriteVmdCameraKey(renderPipeline, selectedModel.relative_path, activeFavoriteVmdAsset.asset_id)
      : "";

  const currentChatSession = useMemo(
    () => chatSessions.find((item) => item.id === chatSessionId) || null,
    [chatSessionId, chatSessions],
  );
  const latestAssistantMessage = [...messages].reverse().find((item) => item.role === "assistant");
  const latestAssistantMessageText = latestAssistantMessage?.content || DEFAULT_ASSISTANT_COPY;
  const activeCameraSnapshot =
    (activeFavoriteVmdCameraKey ? session?.mmdCameraByFavoriteVmd?.[activeFavoriteVmdCameraKey] : null) ??
    session?.mmdCamera?.[renderPipeline] ??
    null;

  useEffect(() => {
    if (!autoFavoriteInteraction) return;
    if (interactionSource !== "default" && interactionSource !== "autoplay") return;
    setInteraction(autoFavoriteInteraction);
    setInteractionSource("autoplay");
    setActiveVmdAssetId(
      currentModelAutoplayAssets.find((asset) => asset.url === autoFavoriteInteraction.vmdUrl)?.asset_id || "",
    );
    setPendingAutoResume(false);
  }, [autoFavoriteInteraction, currentModelAutoplayAssets, interactionSource, selectedModel?.relative_path]);

  useEffect(() => {
    if (autoFavoriteInteraction || interactionSource !== "autoplay") return;
    setInteraction(createDefaultInteractionState());
    setInteractionSource("default");
    setActiveVmdAssetId("");
    setPendingAutoResume(false);
  }, [autoFavoriteInteraction, interactionSource]);

  useEffect(() => {
    setCameraEditMode(false);
  }, [renderPipeline, selectedModelPath]);

  useEffect(() => {
    return () => {
      stopServerAudio({ updateSpeaking: false });
      cancelRealtimeVoicePlayback({ closeSocket: true });
    };
  }, []);

  function previewVmdAsset(asset: VmdAsset) {
    setAdvancedError("");
    setAdvancedMessage(`Previewing ${asset.display_name || asset.filename}`);
    setActiveVmdAssetId(asset.asset_id);
    const preview = createVmdPreviewInteraction(asset, Number(advancedPlaybackRate) || 1);
    setInteractionSource("manual-preview");
    setPendingAutoResume(Boolean(autoplayResumeInteraction));
    setInteraction({
      emotion: preview.emotion,
      action: preview.action,
      mode: "vmd",
      vmdUrl: preview.vmdUrl,
      vmdLoopUrls: [],
      vmdLoopEmotionByUrl: preview.vmdLoopEmotionByUrl,
      playbackRate: preview.playbackRate || DEFAULT_VMD_PLAYBACK_RATE,
      sequence: preview.sequence,
    });
  }

  function resetModelState() {
    stopSpeechPlayback();
    setInteractionSource("default");
    setActiveVmdAssetId("");
    setPendingAutoResume(false);
    setInteraction(createDefaultInteractionState());
    setAdvancedError("");
    setAdvancedMessage("Model reset to default state.");
  }

  async function handleFavoriteAsset(asset: VmdAsset) {
    if (!session || !selectedModel?.relative_path) return;
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const next = await updateVmdAsset(session.userId, asset.asset_id, {
        favorite: !asset.is_favorite,
        model_relative_path: selectedModel.relative_path,
      });
      setAssets((current) => current.map((item) => (item.asset_id === next.asset_id ? next : item)));
      if (next.is_favorite) setActiveVmdAssetId(next.asset_id);
      if (!next.is_favorite && activeVmdAssetId === next.asset_id) setActiveVmdAssetId("");
      setAdvancedMessage(next.is_favorite ? `Favorited ${next.display_name}` : `Removed ${next.display_name} from favorites`);
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "Favorite update failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  function openRenameDialog(asset: VmdAsset) {
    setAdvancedError("");
    setRenameTarget(asset);
    setRenameDraft(asset.display_name || asset.filename);
  }

  function closeRenameDialog() {
    setRenameTarget(null);
    setRenameDraft("");
  }

  function openOpenClawSettings() {
    setIsOpenClawSettingsOpen(true);
    setOpenClawError("");
    setOpenClawMessage("");
    setOpenClawHealth(null);
  }

  function closeOpenClawSettings() {
    setIsOpenClawSettingsOpen(false);
    setOpenClawError("");
    setOpenClawMessage("");
    setOpenClawHealth(null);
  }

  function resetOpenClawDraft() {
    setOpenClawDraft(createOpenClawDraft(openClawSavedConfig));
    setOpenClawError("");
    setOpenClawMessage("已恢复为最近一次读取到的配置。");
    setOpenClawHealth(null);
  }

  async function handleOpenClawSave() {
    if (!session) return;
    const baseUrl = openClawDraft.base_url.trim();
    const timeoutSeconds = Number.parseInt(openClawDraft.timeout_seconds, 10);
    if (!baseUrl) {
      setOpenClawError("Base URL 不能为空。");
      return;
    }
    if (!Number.isFinite(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 300) {
      setOpenClawError("Timeout Seconds 需要在 1 到 300 之间。");
      return;
    }

    setOpenClawSaving(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const saved = await putOpenClawConfig(session.userId, {
        base_url: baseUrl,
        token: openClawDraft.token.trim() ? openClawDraft.token.trim() : null,
        agent_id: openClawDraft.agent_id.trim() || "main",
        model: openClawDraft.model.trim(),
        message_channel: openClawDraft.message_channel.trim() || "feishu",
        proxy_url: openClawDraft.proxy_url.trim(),
        verify_ssl: openClawDraft.verify_ssl,
        timeout_seconds: timeoutSeconds,
      });
      setOpenClawSavedConfig(saved);
      setOpenClawDraft(createOpenClawDraft(saved));
      if (messageBridgeStatus && messageBridgeSelectedSessionKey) {
        const bridgeMessage = await applyMessageBridgeBinding(messageBridgeSelectedSessionKey, {
          openingCurrentMessage: "Bridge Chat 已打开。",
          switchedMessage: "Bridge Session 已切换并打开。",
        });
        setOpenClawMessage(`${saved.message} ${bridgeMessage}`);
      } else {
        setOpenClawMessage(saved.message);
      }
      pushToast("OpenClaw 配置已保存。");
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "OpenClaw 配置保存失败。");
    } finally {
      setOpenClawSaving(false);
    }
  }

  async function handleOpenClawTest() {
    if (!session) return;
    setOpenClawTesting(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const health = await getOpenClawHealth(session.userId);
      setOpenClawHealth(health);
      setOpenClawMessage(health.ok ? "当前 API 运行中的 OpenClaw 连接正常。" : "当前 API 运行中的 OpenClaw 连接异常。");
    } catch (err) {
      setOpenClawHealth(null);
      setOpenClawError(err instanceof Error ? err.message : "OpenClaw 连接测试失败。");
    } finally {
      setOpenClawTesting(false);
    }
  }

  async function handleMessageServiceCleanup() {
    if (!session) return;
    setCleanupBusy(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const result: MessageServiceCleanupResult = await cleanupMessageServiceAdmin(session.userId);
      setOpenClawMessage(
        `清理完成：messages ${result.counts.deleted_soft_deleted_messages}，tts ${result.counts.deleted_soft_deleted_tts}，old terminal ${result.counts.deleted_old_terminal_tts}，orphan jobs ${result.counts.deleted_orphan_tts_jobs}，stale jobs ${result.counts.failed_stale_pending_jobs}。`,
      );
      if (chatSessionId) {
        const nextSessions = await listChatSessions(session.userId);
        setChatSessions(nextSessions);
        if (!nextSessions.some((item) => item.id === chatSessionId)) {
          const fallbackSession = nextSessions[0] || (await createChatSession(session.userId));
          setChatSessions((current) =>
            current.some((item) => item.id === fallbackSession.id) ? current : [fallbackSession, ...current],
          );
          await switchChatSession(fallbackSession);
        }
      }
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "消息服务清理失败。");
    } finally {
      setCleanupBusy(false);
    }
  }

  async function handleMessageBridgeSettingChange(payload: { enabled?: boolean; realtime_drive_character?: boolean }) {
    if (!session) return;
    setMessageBridgeSaving(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const updated = await patchMessageBridgeSettings(session.userId, payload);
      setMessageBridgeStatus((current) => ({ ...(current || updated), ...updated }));
      await loadMessageBridgeStatus({ silent: true });
      setOpenClawMessage("消息桥设置已更新。");
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "消息桥设置更新失败。");
    } finally {
      setMessageBridgeSaving(false);
    }
  }

  function buildFallbackSessionFromBridgeBinding(
    binding: NonNullable<MessageBridgeStatus["binding"]>,
  ): MessageServiceSession {
    return {
      id: binding.local_session_id,
      workspace_id: "",
      account_id: "",
      openclaw_session_key: "",
      title: binding.external_display_name || binding.external_session_key || "Feishu",
      title_source: "default",
      created_at: binding.updated_at,
      updated_at: binding.updated_at,
    };
  }

  async function openBridgeBoundChatSession(
    binding: MessageBridgeStatus["binding"] | null | undefined,
    sessionsOverride?: MessageServiceSession[],
  ) {
    if (!session || !binding?.local_session_id) return false;

    let nextSessions = sessionsOverride || chatSessions;
    let target = nextSessions.find((item) => item.id === binding.local_session_id) || null;
    if (!target) {
      nextSessions = await listChatSessions(session.userId);
      setChatSessions(nextSessions);
      target = nextSessions.find((item) => item.id === binding.local_session_id) || null;
    }

    if (!target) {
      target = buildFallbackSessionFromBridgeBinding(binding);
      setChatSessions((current) =>
        current.some((item) => item.id === target?.id) || !target ? current : [target, ...current],
      );
    }

    if (chatSessionId !== target.id) {
      await switchChatSession(target);
    }
    return true;
  }

  async function applyMessageBridgeBinding(
    externalSessionKey: string,
    messages: { openingCurrentMessage: string; switchedMessage: string },
  ) {
    if (!session || !messageBridgeStatus || !externalSessionKey) return "";
    const isOpeningCurrentBinding = externalSessionKey === messageBridgeStatus.binding?.external_session_key;
    const binding = isOpeningCurrentBinding
      ? messageBridgeStatus.binding
      : await setDefaultMessageBridgeBinding(session.userId, {
          provider: messageBridgeStatus.provider,
          channel: messageBridgeStatus.channel,
          external_session_key: externalSessionKey,
        });

    const [status, nextSessions] = await Promise.all([
      getMessageBridgeStatus(session.userId),
      listChatSessions(session.userId),
    ]);
    setMessageBridgeStatus(status);
    setChatSessions(nextSessions);
    await openBridgeBoundChatSession(status.binding || binding, nextSessions);
    await loadMessageBridgeStatus({ silent: true });
    return isOpeningCurrentBinding ? messages.openingCurrentMessage : messages.switchedMessage;
  }

  async function handleMessageBridgeBindingSwitch() {
    if (!session || !messageBridgeStatus || !messageBridgeSelectedSessionKey) return;
    setMessageBridgeSaving(true);
    setOpenClawError("");
    setOpenClawMessage("");
    try {
      const bridgeMessage = await applyMessageBridgeBinding(messageBridgeSelectedSessionKey, {
        openingCurrentMessage: "Bridge Chat 已打开。",
        switchedMessage: "Bridge Session 已切换。",
      });
      setOpenClawMessage(bridgeMessage);
    } catch (err) {
      setOpenClawError(err instanceof Error ? err.message : "Bridge Session 切换失败。");
    } finally {
      setMessageBridgeSaving(false);
    }
  }

  async function handleRenameAssetConfirm() {
    if (!session || !renameTarget) return;
    const nextName = renameDraft.trim();
    if (!nextName) {
      setAdvancedError("Name is required.");
      return;
    }
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const next = await updateVmdAsset(session.userId, renameTarget.asset_id, {
        display_name: nextName,
        model_relative_path: selectedModel?.relative_path,
      });
      setAssets((current) => current.map((item) => (item.asset_id === next.asset_id ? next : item)));
      setAdvancedMessage(`Renamed to ${next.display_name}`);
      closeRenameDialog();
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "Rename failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  function handleRenameDialogKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeRenameDialog();
      return;
    }
    if (event.key === "Enter") {
      const target = event.target;
      if (target instanceof HTMLButtonElement) return;
      event.preventDefault();
      void handleRenameAssetConfirm();
    }
  }

  async function handleAdvancedUpload(fileListLike: FileList | File[]) {
    if (!session) return;
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const files = collectImportableVmdFiles(fileListLike);
      if (!files.length) {
        setAdvancedError("No importable .vmd files were found.");
        return;
      }

      const importedItems: VmdAsset[] = [];
      for (const file of files) {
        const item = await uploadVmdAsset(session.userId, advancedSlot, file);
        importedItems.push(item);
      }

      setAssets((current) => {
        const deduped = current.filter((asset) => !importedItems.some((item) => item.asset_id === asset.asset_id));
        return [...importedItems, ...deduped];
      });

      const visibleImportedItems = excludeEntryStandbyAssets(importedItems);
      if (visibleImportedItems[0]) {
        previewVmdAsset(visibleImportedItems[0]);
      }
      setAdvancedMessage(`Imported ${importedItems.length} VMD file(s).`);
      setIsAdvancedPanelOpen(true);
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "VMD import failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  function handleRenderPipelineChange(nextPipeline: RenderPipeline) {
    setRenderPipeline(nextPipeline);
    setCameraEditMode(false);
    if (!session) return;
    const nextSession = { ...session, renderPipeline: nextPipeline };
    setSession(nextSession);
    saveSession(nextSession);
  }

  function handleUnlockMmdCamera() {
    setAdvancedError("");
    const snapshot = stageRef.current?.unlockCamera();
    if (!snapshot) {
      setAdvancedError("Camera is not ready yet.");
      return;
    }
    setCameraEditMode(true);
    setAdvancedMessage("Editing camera. Drag, pan, or zoom on the MMD stage, then save this framing.");
  }

  function handleSaveMmdCamera() {
    setAdvancedError("");
    if (!session) return;
    const snapshot = stageRef.current?.captureCamera();
    if (!snapshot) {
      setAdvancedError("Camera is not ready yet.");
      return;
    }
    const savedSnapshot: MmdCameraSnapshot = { ...snapshot, locked: false };
    stageRef.current?.unlockCamera();
    console.info("[mmd-camera] saved snapshot", savedSnapshot);
    const nextSession: UserSession = activeFavoriteVmdCameraKey
      ? {
          ...session,
          mmdCameraByFavoriteVmd: {
            ...(session.mmdCameraByFavoriteVmd || {}),
            [activeFavoriteVmdCameraKey]: savedSnapshot,
          },
        }
      : {
          ...session,
          mmdCamera: {
            ...(session.mmdCamera || {}),
            [renderPipeline]: savedSnapshot,
          },
        };
    setSession(nextSession);
    saveSession(nextSession);
    setCameraEditMode(false);
    setAdvancedMessage(
      activeFavoriteVmdAsset
        ? `Camera saved for ${activeFavoriteVmdAsset.display_name || activeFavoriteVmdAsset.filename}.`
        : `Camera saved for ${renderPipeline}.`,
    );
  }

  function handleResetMmdCamera() {
    setAdvancedError("");
    if (!session) return;
    const snapshot = stageRef.current?.resetCamera();
    if (!snapshot) {
      setAdvancedError("Camera is not ready yet.");
      return;
    }
    const nextCamera = { ...(session.mmdCamera || {}) };
    const nextFavoriteCameras = { ...(session.mmdCameraByFavoriteVmd || {}) };
    if (activeFavoriteVmdCameraKey) {
      delete nextFavoriteCameras[activeFavoriteVmdCameraKey];
    } else {
      delete nextCamera[renderPipeline];
    }
    const nextSession: UserSession = {
      ...session,
      mmdCamera: Object.keys(nextCamera).length ? nextCamera : undefined,
      mmdCameraByFavoriteVmd: Object.keys(nextFavoriteCameras).length ? nextFavoriteCameras : undefined,
    };
    setSession(nextSession);
    saveSession(nextSession);
    setCameraEditMode(false);
    setAdvancedMessage(
      activeFavoriteVmdAsset
        ? `Camera reset for ${activeFavoriteVmdAsset.display_name || activeFavoriteVmdAsset.filename}.`
        : `Camera reset to the ${renderPipeline} default.`,
    );
  }

  function stopServerAudio({ updateSpeaking = true }: { updateSpeaking?: boolean } = {}) {
    const audio = serverAudioRef.current;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    }
    if (serverAudioCleanupRef.current) {
      serverAudioCleanupRef.current();
      serverAudioCleanupRef.current = null;
    }
    serverAudioRef.current = null;
    if (updateSpeaking) {
      setSpeaking(false);
    }
    setActiveTtsMessageId("");
  }

  async function handleExportMotionContext() {
    if (!session || !selectedModel?.relative_path) return;
    setAdvancedBusy(true);
    setAdvancedError("");
    setAdvancedMessage("");
    try {
      const exported = await createMotionContextExport(session.userId, selectedModel.relative_path);
      setLatestMotionContextExport(exported);
      setAdvancedMessage(`Exported ${exported.motion_count} favorite motion(s) for ${exported.model_display_name}.`);
    } catch (err) {
      setAdvancedError(err instanceof Error ? err.message : "Motion context export failed.");
    } finally {
      setAdvancedBusy(false);
    }
  }

  function stopSpeechPlayback() {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    stopServerAudio();
  }

  function pushToast(message: string) {
    setToast({ id: Date.now(), message });
  }

  function handleTtsFailure(message: string) {
    ignoreNextStageCompletionResetRef.current = true;
    pushToast(message);
  }

  function updateMessageTts(messageId: string, tts: ChatMessageTts) {
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, tts } : message)));
  }

  function patchMessageTts(messageId: string, patch: Partial<ChatMessageTts>) {
    setMessages((current) =>
      current.map((message) => {
        if (message.id !== messageId) return message;
        return {
          ...message,
          tts: {
            ...(message.tts || { mode: "server" as const, status: "loading" as const }),
            ...patch,
          },
        };
      }),
    );
  }

  function realtimeProxyAudioUrl(audioUrl: string, userId: string) {
    const separator = audioUrl.includes("?") ? "&" : "?";
    const authenticatedPath = `${audioUrl}${separator}user_id=${encodeURIComponent(userId)}`;
    if (/^https?:\/\//i.test(authenticatedPath)) return authenticatedPath;
    return `/api/backend${authenticatedPath.startsWith("/") ? authenticatedPath : `/${authenticatedPath}`}`;
  }

  async function refreshMessageFromServer(messageId: string) {
    if (!session) return null;
    const next = await getMessageById(session.userId, messageId);
    const mapped = mapServerMessageToChatMessage(next);
    setMessages((current) => current.map((message) => (message.id === messageId ? { ...message, ...mapped } : message)));
    return mapped;
  }

  function getRealtimeAudioQueue(): RealtimeAudioQueue {
    if (!audioQueueRef.current) {
      const RealtimeAudioQueue = AudioQueue as unknown as RealtimeAudioQueueCtor;
      audioQueueRef.current = new RealtimeAudioQueue({
        onChunkStart: (entry: { jobId: string; messageId?: string }) => {
          const messageId = entry.messageId || realtimeVoiceJobMessageRef.current.get(entry.jobId) || "";
          setSpeaking(true);
          setActiveTtsMessageId(messageId);
          setRealtimeVoiceStatus("playing");
        },
        onChunkEnd: (entry: { jobId: string; messageId?: string }) => {
          const messageId = entry.messageId || realtimeVoiceJobMessageRef.current.get(entry.jobId) || "";
          setSpeaking(false);
          setActiveTtsMessageId((current) => (current === messageId ? "" : current));
          setRealtimeVoiceStatus("idle");
        },
        onError: (event: { jobId: string; messageId?: string; fallback: RealtimeVoiceFallbackMode; error?: Error }) => {
          void handleRealtimeVoicePlaybackError(event);
        },
      });
    }
    return audioQueueRef.current;
  }

  async function playMessageLevelTtsFallback(messageId: string, reason: string) {
    const message = messagesRef.current.find((item) => item.id === messageId);
    if (!message) return;
    setRealtimeVoiceStatus("fallback");
    patchMessageTts(messageId, { status: "pending", mode: "server", error: reason });
    try {
      await prepareAndPlayMessageTts({
        ...message,
        tts: {
          ...(message.tts || {}),
          status: "pending",
          mode: "server",
          error: reason,
        },
      });
    } catch (error) {
      patchMessageTts(messageId, {
        status: "failed",
        mode: "server",
        error: error instanceof Error ? error.message : "Voice fallback failed.",
      });
      handleTtsFailure(error instanceof Error ? `语音回退失败：${error.message}` : "语音回退失败。");
    }
  }

  async function handleRealtimeVoicePlaybackError(event: {
    jobId: string;
    messageId?: string;
    fallback: RealtimeVoiceFallbackMode;
    error?: Error;
  }) {
    const messageId = event.messageId || realtimeVoiceJobMessageRef.current.get(event.jobId) || "";
    if (!messageId) return;
    if (event.fallback === "auto_before_playback") {
      await playMessageLevelTtsFallback(messageId, event.error?.message || "Realtime voice playback failed.");
      return;
    }
    setRealtimeVoiceStatus("partial_failed");
    patchMessageTts(messageId, {
      status: "partial_failed",
      mode: "server",
      error: event.error?.message || "Realtime voice playback failed after partial playback.",
    });
    handleTtsFailure("实时语音已部分播放，后续片段失败。可手动重播完整语音。");
  }

  function handleRealtimeVoiceFailure(event: RealtimeVoiceServerEvent) {
    const jobId = event.job_id || "";
    const messageId = event.message_id || realtimeVoiceJobMessageRef.current.get(jobId) || "";
    if (!messageId) return;
    const fallbackMode =
      jobId && audioQueueRef.current
        ? audioQueueRef.current.fallbackForJobError(jobId)
        : ("auto_before_playback" as RealtimeVoiceFallbackMode);
    const reason = event.detail || event.reason || "Realtime voice synthesis failed.";
    if (fallbackMode === "auto_before_playback") {
      void playMessageLevelTtsFallback(messageId, reason);
      return;
    }
    setRealtimeVoiceStatus("partial_failed");
    patchMessageTts(messageId, { status: "partial_failed", mode: "server", error: reason });
    handleTtsFailure("实时语音已部分播放，后续片段失败。可手动重播完整语音。");
  }

  function handleRealtimeVoiceEvent(event: RealtimeVoiceServerEvent) {
    const messageId = event.message_id || realtimeVoiceJobMessageRef.current.get(event.job_id || "") || "";
    if (event.type === "queued") {
      setRealtimeVoiceStatus("queued");
      if (messageId) patchMessageTts(messageId, { status: "loading", mode: "server" });
      return;
    }
    if (event.type === "synthesis_started") {
      setRealtimeVoiceStatus("synthesizing");
      if (messageId) patchMessageTts(messageId, { status: "loading", mode: "server" });
      return;
    }
    if (event.type === "audio_ready" && event.job_id && event.audio_url) {
      const activeSession = sessionRef.current;
      if (!activeSession) return;
      if (messageId) {
        realtimeVoiceJobMessageRef.current.set(event.job_id, messageId);
        patchMessageTts(messageId, { status: "loading", mode: "server" });
      }
      getRealtimeAudioQueue().enqueue({
        jobId: event.job_id,
        messageId,
        sequence: Number(event.sequence || 0),
        url: realtimeProxyAudioUrl(event.audio_url, activeSession.userId),
        text: event.text,
        duration: event.duration,
      });
      return;
    }
    if (event.type === "rejected" || event.type === "error") {
      handleRealtimeVoiceFailure(event);
      return;
    }
    if (event.type === "cancelled" || event.type === "done") {
      setRealtimeVoiceStatus((current) => (current === "partial_failed" ? current : "idle"));
    }
  }

  async function ensureRealtimeVoiceSocket() {
    const activeSession = sessionRef.current;
    const activeSessionId = chatSessionIdRef.current;
    if (!activeSession || !activeSessionId) return null;
    const existing = voiceSocketRef.current;
    if (existing?.readyState === WebSocket.OPEN) return existing;
    if (existing && existing.readyState !== WebSocket.CLOSED) {
      existing.close();
    }

    const socket = new WebSocket(sessionVoiceWebSocketUrl(activeSessionId, activeSession.userId));
    voiceSocketRef.current = socket;
    setRealtimeVoiceStatus("connecting");

    socket.addEventListener("message", (event) => {
      try {
        handleRealtimeVoiceEvent(JSON.parse(String(event.data)) as RealtimeVoiceServerEvent);
      } catch {
        setRealtimeVoiceStatus("failed");
      }
    });
    socket.addEventListener("close", () => {
      if (voiceSocketRef.current === socket) {
        voiceSocketRef.current = null;
      }
      setRealtimeVoiceStatus((current) => (current === "partial_failed" ? current : "idle"));
    });
    socket.addEventListener("error", () => {
      setRealtimeVoiceStatus("failed");
    });

    return new Promise<WebSocket>((resolve, reject) => {
      const cleanup = () => {
        socket.removeEventListener("open", handleOpen);
        socket.removeEventListener("error", handleError);
        socket.removeEventListener("close", handleClose);
      };
      const handleOpen = () => {
        cleanup();
        setRealtimeVoiceStatus("idle");
        resolve(socket);
      };
      const handleError = () => {
        cleanup();
        reject(new Error("Realtime voice WebSocket failed."));
      };
      const handleClose = () => {
        cleanup();
        reject(new Error("Realtime voice WebSocket closed."));
      };
      socket.addEventListener("open", handleOpen);
      socket.addEventListener("error", handleError);
      socket.addEventListener("close", handleClose);
    });
  }

  async function startRealtimeVoiceSynthesis(message: ChatMessage) {
    if (!session || !chatSessionId || !message.id || !message.content.trim()) return false;
    try {
      const socket = await ensureRealtimeVoiceSocket();
      if (!socket || socket.readyState !== WebSocket.OPEN) return false;
      const jobId = createMessageId("voice-job");
      realtimeVoiceJobMessageRef.current.set(jobId, message.id);
      patchMessageTts(message.id, { status: "loading", mode: "server" });
      setRealtimeVoiceStatus("queued");
      socket.send(
        JSON.stringify({
          type: "synthesize",
          job_id: jobId,
          message_id: message.id,
          text: message.content,
        }),
      );
      return true;
    } catch {
      setRealtimeVoiceStatus("failed");
      return false;
    }
  }

  function cancelRealtimeVoicePlayback({ closeSocket = false }: { closeSocket?: boolean } = {}) {
    audioQueueRef.current?.clear();
    setSpeaking(false);
    setActiveTtsMessageId("");
    setRealtimeVoiceStatus("idle");
    const socket = voiceSocketRef.current;
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "cancel", scope: "all" }));
    }
    if (closeSocket && socket) {
      socket.close();
      voiceSocketRef.current = null;
    }
  }

  function driveCharacterFromBridgeMessage(message: MessageServiceMessage) {
    if (message.role !== "assistant") return;
    if (message.metadata?.source !== "message_bridge" || message.metadata?.synced_from !== "realtime") return;
    if (!messageBridgeStatus?.realtime_drive_character) return;

    const motionResolution = message.motion_resolution;
    if (motionResolution?.status === "matched" && motionResolution.resolved_asset_url) {
      const plannedAsset = motionResolution.resolved_asset_id ? assetIndex[motionResolution.resolved_asset_id] : undefined;
      setInteractionSource("chat");
      setActiveVmdAssetId(motionResolution.resolved_asset_id || "");
      setPendingAutoResume(Boolean(autoplayResumeInteraction));
      setInteraction({
        emotion: message.emotion || "neutral",
        action: message.action || "idle",
        mode: "vmd",
        vmdUrl: motionResolution.resolved_asset_url,
        vmdLoopUrls: [],
        vmdLoopEmotionByUrl: { [motionResolution.resolved_asset_url]: message.emotion || "neutral" },
        playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: motionResolution.resolved_asset_url }),
        sequence: [],
      });
      return;
    }

    const plan = resolvePlaybackPlan({
      slot: message.emotion || "neutral",
      action: message.action || "idle",
      motionPlan: message.motion_plan || undefined,
      userMappings: mappings,
      defaultMappings: {},
      assetIndex,
    });
    setInteractionSource("chat");
    setPendingAutoResume(Boolean(autoplayResumeInteraction));
    if (plan.mode === "vmd") {
      const plannedAsset = Object.values(assetIndex).find((item) => item.url === plan.url);
      setActiveVmdAssetId(plannedAsset?.asset_id || "");
      setInteraction({
        emotion: message.emotion || "neutral",
        action: message.action || "idle",
        mode: "vmd",
        vmdUrl: plan.url,
        vmdLoopUrls: [],
        vmdLoopEmotionByUrl: plan.url ? { [plan.url]: message.emotion || "neutral" } : {},
        playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: plan.url }),
        sequence: [],
      });
      return;
    }

    setActiveVmdAssetId("");
    setInteraction({
      emotion: message.emotion || "neutral",
      action: plan.action,
      mode: "procedural",
      vmdUrl: "",
      vmdLoopEmotionByUrl: {},
      playbackRate: 1,
      sequence: plan.sequence || [],
    });
  }

  async function refreshActiveSessionMessages({ driveBridgeMessages = false }: { driveBridgeMessages?: boolean } = {}) {
    if (!session || !chatSessionId || loading || chatBootstrapping || sessionBusy) return;
    const serverMessages = await listSessionMessages(session.userId, chatSessionId);
    let newServerMessages: MessageServiceMessage[] = [];
    setMessages((current) => {
      const knownIds = new Set(current.map((message) => message.id).filter(Boolean));
      newServerMessages = serverMessages.filter((message) => !knownIds.has(message.id));
      const sameLength = current.length === serverMessages.length;
      const sameIds = sameLength && current.every((message, index) => message.id === serverMessages[index]?.id);
      if (sameIds) return current;
      return serverMessages.map(mapServerMessageToChatMessage);
    });
    if (driveBridgeMessages) {
      for (const message of newServerMessages) {
        driveCharacterFromBridgeMessage(message);
      }
    }
  }

  async function switchChatSession(nextSession: MessageServiceSession) {
    if (!session) return;
    setSessionBusy(true);
    setError("");
    cancelRealtimeVoicePlayback({ closeSocket: true });
    try {
      const serverMessages = await listSessionMessages(session.userId, nextSession.id);
      setChatSessionId(nextSession.id);
      setMessages(serverMessages.map(mapServerMessageToChatMessage));
      if (nextSession.selected_model_path) {
        setSelectedModelPath(nextSession.selected_model_path);
      }
      const nextUserSession = { ...session, activeChatSessionId: nextSession.id };
      setSession(nextUserSession);
      saveSession(nextUserSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话切换失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleCreateSession() {
    if (!session) return;
    setSessionBusy(true);
    setError("");
    cancelRealtimeVoicePlayback({ closeSocket: true });
    try {
      const created = await createChatSession(session.userId, { selected_model_path: selectedModelPath || null });
      setChatSessions((current) => [created, ...current]);
      setChatSessionId(created.id);
      setMessages([]);
      const nextUserSession = { ...session, activeChatSessionId: created.id };
      setSession(nextUserSession);
      saveSession(nextUserSession);
    } catch (err) {
      setError(err instanceof Error ? err.message : "新会话创建失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleSelectSession(sessionId: string) {
    if (sessionId === chatSessionId) return;
    const target = chatSessions.find((item) => item.id === sessionId);
    if (!target) return;
    await switchChatSession(target);
  }

  async function handleRenameSession(target: MessageServiceSession) {
    if (!session) return;
    const nextTitle = window.prompt("重命名会话", target.title)?.trim();
    if (!nextTitle || nextTitle === target.title) return;
    setSessionBusy(true);
    setError("");
    try {
      const updated = await updateChatSession(session.userId, target.id, { title: nextTitle });
      setChatSessions((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话重命名失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function handleDeleteSession(target: MessageServiceSession) {
    if (!session) return;
    if (!window.confirm(`删除会话“${target.title}”？`)) return;
    setSessionBusy(true);
    setError("");
    try {
      await deleteChatSession(session.userId, target.id);
      const remaining = chatSessions.filter((item) => item.id !== target.id);
      setChatSessions(remaining);
      if (target.id === chatSessionId) {
        if (remaining.length > 0) {
          await switchChatSession(remaining[0]);
        } else {
          const created = await createChatSession(session.userId, { selected_model_path: selectedModelPath || null });
          setChatSessions([created]);
          setChatSessionId(created.id);
          setMessages([]);
          const nextUserSession = { ...session, activeChatSessionId: created.id };
          setSession(nextUserSession);
          saveSession(nextUserSession);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "会话删除失败。");
    } finally {
      setSessionBusy(false);
    }
  }

  async function playServerAudio(audioBlob: Blob, messageId = "") {
    stopSpeechPlayback();
    setActiveTtsMessageId(messageId);
    const controller = await playServerTtsAudio(audioBlob, {
      setSpeaking: (value?: boolean) => setSpeaking(Boolean(value)),
      onCleanup: ({ audio }: { audio?: HTMLAudioElement } = {}) => {
        if (audio && serverAudioRef.current === audio) {
          serverAudioRef.current = null;
          serverAudioCleanupRef.current = null;
        }
        setActiveTtsMessageId((current) => (current === messageId ? "" : current));
      },
    });
    serverAudioRef.current = controller.audio as HTMLAudioElement;
    serverAudioCleanupRef.current = controller.cleanup;
  }

  async function playRemoteServerAudio(message: ChatMessage) {
    const remoteAudioUrl = message.tts?.remoteAudioUrl;
    const proxyAudioUrl = message.tts?.proxyAudioUrl;
    if (!remoteAudioUrl) {
      throw new Error("远端音频地址缺失。");
    }
    stopSpeechPlayback();
    setActiveTtsMessageId(message.id || "");

    const audio = new Audio(remoteAudioUrl);
    serverAudioRef.current = audio;
    let usingProxyFallback = false;
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      if (serverAudioRef.current === audio) {
        serverAudioRef.current = null;
        serverAudioCleanupRef.current = null;
      }
      setSpeaking(false);
      setActiveTtsMessageId((current) => (current === (message.id || "") ? "" : current));
    };
    serverAudioCleanupRef.current = cleanup;

    audio.onplay = () => setSpeaking(true);
    audio.onended = cleanup;
    audio.onerror = async () => {
      if (!usingProxyFallback && proxyAudioUrl) {
        usingProxyFallback = true;
        audio.src = proxyAudioUrl;
        try {
          await audio.play();
          return;
        } catch {
          // fall through to final failure handling
        }
      }
      cleanup();
      if (message.id && session) {
        await refreshMessageFromServer(message.id);
      }
      handleTtsFailure("远端语音播放失败。");
    };

    try {
      await audio.play();
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  function browserSpeak(text: string, messageId = "") {
    stopServerAudio();
    if (!("speechSynthesis" in window)) {
      handleTtsFailure("当前环境不支持浏览器语音播放。");
      return;
    }
    window.speechSynthesis.cancel();
    setActiveTtsMessageId(messageId);
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = 1.03;
    utter.pitch = 1.08;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => {
      setSpeaking(false);
      setActiveTtsMessageId((current) => (current === messageId ? "" : current));
    };
    utter.onerror = () => {
      setSpeaking(false);
      setActiveTtsMessageId((current) => (current === messageId ? "" : current));
      handleTtsFailure("浏览器语音播放失败。");
    };
    try {
      window.speechSynthesis.speak(utter);
    } catch {
      setSpeaking(false);
      setActiveTtsMessageId((current) => (current === messageId ? "" : current));
      handleTtsFailure("浏览器语音播放失败。");
    }
  }

  async function prepareAndPlayAssistantTts(message: ChatMessage) {
    if (!ttsEnabled || !session || !message.id) return;
    if (ttsMode === "browser") {
      updateMessageTts(message.id, { status: "ready", mode: "browser" });
      browserSpeak(message.content, message.id);
      return;
    }

    if (await startRealtimeVoiceSynthesis(message)) {
      return;
    }
    await prepareAndPlayMessageTts(message);
  }

  async function prepareAndPlayMessageTts(message: ChatMessage) {
    if (!session || !message.id) return;
    let currentMessage = message;
    if (
      !currentMessage.tts ||
      currentMessage.tts.status === "loading" ||
      currentMessage.tts.status === "partial_failed"
    ) {
      const optimisticTts: ChatMessageTts = { status: "pending", mode: "server" };
      currentMessage = { ...currentMessage, tts: optimisticTts };
      updateMessageTts(message.id, optimisticTts);
    }
    if (currentMessage.tts?.status === "pending") {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
        const refreshed = await refreshMessageFromServer(message.id);
        if (!refreshed?.tts) break;
        currentMessage = refreshed;
        if (refreshed.tts.status === "ready" || refreshed.tts.status === "failed" || refreshed.tts.status === "expired") {
          break;
        }
      }
    }

    if (currentMessage.tts?.status === "ready") {
      await playMessageAudio(currentMessage);
      return;
    }

    if (currentMessage.tts?.status === "failed") {
      throw new Error(currentMessage.tts.error || "语音生成失败。");
    }

    if (currentMessage.tts?.status === "expired") {
      const regenerated = await regenerateMessageTts(session.userId, message.id);
      currentMessage = mapServerMessageToChatMessage(regenerated);
      setMessages((current) => current.map((item) => (item.id === message.id ? currentMessage : item)));
      if (currentMessage.tts?.status === "ready") {
        await playMessageAudio(currentMessage);
        return;
      }
      throw new Error(currentMessage.tts?.error || "语音重新生成失败。");
    }
  }

  async function playMessageAudio(message: ChatMessage) {
    if (message.tts?.status !== "ready") return;
    if (message.tts.mode === "server" && message.tts.audio) {
      await playServerAudio(message.tts.audio, message.id || "");
      return;
    }
    if (message.tts.mode === "server" && message.tts.remoteAudioUrl) {
      await playRemoteServerAudio(message);
      return;
    }
    browserSpeak(message.content, message.id || "");
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session || !chatSessionId || !input.trim() || loading || chatBootstrapping) return;

    const userText = input.trim();
    const optimisticUserMessageId = createMessageId("user-pending");
    const optimisticUserMessage: ChatMessage = {
      id: optimisticUserMessageId,
      role: "user",
      content: userText,
      createdAt: new Date().toISOString(),
    };
    ignoreNextStageCompletionResetRef.current = false;
    setInput("");
    setError("");
    setBackgroundActivityPulse((current) => current + 1);
    setLoading(true);
    setMessages((prev) => [...prev, optimisticUserMessage]);
    const traceId = crypto.randomUUID();

    try {
      const response = await postSessionMessage(
        session.userId,
        chatSessionId,
        {
          content: userText,
          tts_enabled: ttsEnabled && ttsMode === "server",
          selected_model_path: selectedModelPath || null,
        },
        traceId,
      );

      const userMessage = mapServerMessageToChatMessage(response.user_message);
      const assistantMessage = mapServerMessageToChatMessage(response.assistant_message);
      if (ttsEnabled && ttsMode === "browser" && assistantMessage.id) {
        assistantMessage.tts = { status: "ready", mode: "browser" };
      }
      if (ttsEnabled && ttsMode === "server" && assistantMessage.id && !assistantMessage.tts) {
        assistantMessage.tts = { status: "pending", mode: "server" };
      }
      setMessages((prev) => [
        ...prev.filter((message) => message.id !== optimisticUserMessageId),
        userMessage,
        assistantMessage,
      ]);
      setLoading(false);

      const motionResolution = response.assistant_message.motion_resolution;
      if (motionResolution?.status === "matched" && motionResolution.resolved_asset_url) {
        const plannedAsset = motionResolution.resolved_asset_id ? assetIndex[motionResolution.resolved_asset_id] : undefined;
        setInteractionSource("chat");
        setActiveVmdAssetId(motionResolution.resolved_asset_id || "");
        setPendingAutoResume(Boolean(autoplayResumeInteraction));
        setInteraction({
          emotion: response.assistant_message.emotion || "neutral",
          action: response.assistant_message.action || "idle",
          mode: "vmd",
          vmdUrl: motionResolution.resolved_asset_url,
          vmdLoopUrls: [],
          vmdLoopEmotionByUrl: { [motionResolution.resolved_asset_url]: response.assistant_message.emotion || "neutral" },
          playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: motionResolution.resolved_asset_url }),
          sequence: [],
        });
      } else {
        const plan = resolvePlaybackPlan({
          slot: response.assistant_message.emotion || "neutral",
          action: response.assistant_message.action || "idle",
          motionPlan: response.assistant_message.motion_plan || undefined,
          userMappings: mappings,
          defaultMappings: {},
          assetIndex,
        });

        if (plan.mode === "vmd") {
          const plannedAsset = Object.values(assetIndex).find((item) => item.url === plan.url);
          setInteractionSource("chat");
          setActiveVmdAssetId(plannedAsset?.asset_id || "");
          setPendingAutoResume(Boolean(autoplayResumeInteraction));
          setInteraction({
          emotion: response.assistant_message.emotion || "neutral",
          action: response.assistant_message.action || "idle",
          mode: "vmd",
          vmdUrl: plan.url,
          vmdLoopUrls: [],
          vmdLoopEmotionByUrl: plan.url ? { [plan.url]: response.assistant_message.emotion || "neutral" } : {},
          playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: plan.url }),
          sequence: [],
        });
        } else {
          setInteractionSource("chat");
          setActiveVmdAssetId("");
          setPendingAutoResume(Boolean(autoplayResumeInteraction));
          setInteraction({
            emotion: response.assistant_message.emotion || "neutral",
            action: plan.action,
            mode: "procedural",
            vmdUrl: "",
            vmdLoopEmotionByUrl: {},
            playbackRate: 1,
            sequence: plan.sequence || [],
          });
        }
      }

      try {
        await prepareAndPlayAssistantTts(assistantMessage);
      } catch (speakError) {
        if (assistantMessage.id) {
          updateMessageTts(assistantMessage.id, {
          status: "failed",
          mode: ttsMode,
          error: speakError instanceof Error ? speakError.message : "语音播放失败。",
        });
        }
        handleTtsFailure(speakError instanceof Error ? `语音播放失败：${speakError.message}` : "语音播放失败。");
      }
    } catch (err) {
      setMessages((prev) => prev.filter((message) => message.id !== optimisticUserMessageId));
      pushToast(err instanceof Error ? err.message : "\u8bf7\u6c42\u5931\u8d25\u3002");
    } finally {
      setLoading(false);
    }
  }

  function handleCharacterSwitch(nextPath: string) {
    stopSpeechPlayback();
    setInteraction(createDefaultInteractionState());
    setInteractionSource("default");
    setActiveVmdAssetId("");
    setPendingAutoResume(false);
    setSelectedModelPath(nextPath);
  }

  function handleStageInteractionComplete() {
    if (ignoreNextStageCompletionResetRef.current) {
      ignoreNextStageCompletionResetRef.current = false;
      setPendingAutoResume(false);
      return;
    }

    if (pendingAutoResume && autoplayResumeInteraction) {
      setInteraction(autoplayResumeInteraction);
      setInteractionSource("autoplay");
      setPendingAutoResume(false);
      return;
    }

    setInteractionSource("default");
    setPendingAutoResume(false);
  }

  if (!session) {
    return (
      <main className="page-shell" style={{ display: "grid", placeItems: "center" }}>
        <section className="panel" style={{ width: "min(520px, 92vw)", padding: "1.2rem" }}>
          <h2 style={{ marginTop: 0 }}>{"\u672a\u767b\u5f55"}</h2>
          <p className="muted">{"\u8bf7\u5148\u8fd4\u56de\u767b\u5f55\u9875\u8f93\u5165\u7528\u6237 ID\u3002"}</p>
          <Link className="btn" href="/">
            {"\u53bb\u767b\u5f55"}
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main
      className={`mio-hud${isCompactHud ? " is-compact" : ""}`}
      data-testid="mio-hud"
      data-render-pipeline={renderPipeline}
    >
      <MioModeBackground
        active={renderPipeline === "mio-reference"}
        speaking={speaking}
        emotion={interaction.emotion}
        action={interaction.action}
        activityPulse={backgroundActivityPulse}
      />
      <header className="mio-topbar" data-testid="mio-topbar">
        <div className="mio-brand">
          <img src={`${SPRITE}/asset-082.png`} alt="" />
          <h1>MIO</h1>
          <span>// PERSONAL AI</span>
        </div>

        <div className="mio-system-state">
          <span className="mio-dot" />
          <strong>LIVE</strong>
          <span>@ MEMORY SYNCED</span>
        </div>

        <div className="mio-session">
          <div className="mio-session-meta">
            <span>USER: {session.userId}</span>
            <span>SESSION: {(chatSessionId || "------").slice(0, 6).toUpperCase()}</span>
            <span>TITLE: {currentChatSession?.title || "新对话"}</span>
          </div>
          <div className="mio-session-actions">
            <Link href="/traces" className="mio-trace-button">
              TRACE
            </Link>
            <button
              className="mio-icon-button"
              type="button"
              aria-label="Open OpenClaw settings"
              aria-expanded={isOpenClawSettingsOpen}
              onClick={openOpenClawSettings}
            >
              <span className="mio-nav-glyph" aria-hidden="true">
                {renderSidebarIcon("settings")}
              </span>
            </button>
            <button
              className="mio-avatar-stack"
              type="button"
              onClick={() => {
                clearSession();
                router.push("/");
              }}
              aria-label={"\u9000\u51fa\u767b\u5f55"}
            >
              <img className="mio-avatar" src={`${SPRITE}/asset-030.png`} alt={"\u5f53\u524d\u89d2\u8272\u5934\u50cf"} />
            </button>
          </div>
        </div>
      </header>

      {isOpenClawSettingsOpen ? (
        <div className="mio-settings-layer" role="presentation">
          <button
            type="button"
            className="mio-settings-backdrop"
            aria-label="Close OpenClaw settings"
            onClick={closeOpenClawSettings}
          />
          <section
            className="mio-settings-panel"
            role="dialog"
            aria-modal="true"
            aria-label="OpenClaw settings"
          >
            <header className="mio-settings-head">
              <div>
                <strong>OpenClaw</strong>
                <span>保存会写入 `api/.env` 并立即刷新当前 API 的 OpenClaw 配置，测试连接读取的是运行中的后端配置。</span>
              </div>
              <button type="button" className="mio-advanced-close" onClick={closeOpenClawSettings} aria-label="Close">
                ×
              </button>
            </header>

            <div className="mio-settings-body">
              {openClawError ? <p className="mio-advanced-error">{openClawError}</p> : null}
              {openClawMessage && !openClawError ? <p className="mio-advanced-empty">{openClawMessage}</p> : null}

              <div className="mio-settings-grid">
                <label className="mio-advanced-field mio-advanced-field-wide">
                  <span>Base URL</span>
                  <input
                    type="url"
                    value={openClawDraft.base_url}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, base_url: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field mio-advanced-field-wide">
                  <span>Token</span>
                  <input
                    type="password"
                    value={openClawDraft.token}
                    placeholder={openClawDraft.token_configured ? "已配置，留空则保持不变" : "未配置"}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, token: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Agent ID</span>
                  <input
                    value={openClawDraft.agent_id}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, agent_id: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Model</span>
                  <input
                    value={openClawDraft.model}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, model: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Message Channel</span>
                  <input
                    value={openClawDraft.message_channel}
                    onChange={(event) =>
                      setOpenClawDraft((current) => ({ ...current, message_channel: event.target.value }))
                    }
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Proxy URL</span>
                  <input
                    type="url"
                    value={openClawDraft.proxy_url}
                    onChange={(event) => setOpenClawDraft((current) => ({ ...current, proxy_url: event.target.value }))}
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field">
                  <span>Timeout Seconds</span>
                  <input
                    type="number"
                    min="1"
                    max="300"
                    value={openClawDraft.timeout_seconds}
                    onChange={(event) =>
                      setOpenClawDraft((current) => ({ ...current, timeout_seconds: event.target.value }))
                    }
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
                <label className="mio-advanced-field mio-advanced-toggle">
                  <span>Verify SSL</span>
                  <input
                    type="checkbox"
                    checked={openClawDraft.verify_ssl}
                    onChange={(event) =>
                      setOpenClawDraft((current) => ({ ...current, verify_ssl: event.target.checked }))
                    }
                    disabled={openClawLoading || openClawSaving}
                  />
                </label>
              </div>

              <section className="mio-settings-diagnostics" aria-label="Message bridge status">
                <div className="mio-settings-diagnostics-head">
                  <strong>Message Bridge</strong>
                  <span>
                    {messageBridgeLoading
                      ? "Loading..."
                      : messageBridgeStatus
                        ? `${messageBridgeStatus.provider}/${messageBridgeStatus.channel}`
                        : "Not loaded"}
                  </span>
                </div>
                <div className="mio-settings-meta">
                  <span>Status: {messageBridgeStatus?.websocket_status || "--"}</span>
                  <span>Reconnects: {messageBridgeStatus?.reconnect_attempts ?? "--"}</span>
                  <span>Last connected: {messageBridgeStatus?.last_connected_at || "--"}</span>
                  <span>Binding: {messageBridgeStatus?.binding?.external_display_name || messageBridgeStatus?.binding?.external_session_key || "--"}</span>
                  {messageBridgeStatus?.last_error ? <span>Error: {messageBridgeStatus.last_error}</span> : null}
                </div>
                <div className="mio-settings-grid">
                  <label className="mio-advanced-field mio-advanced-field-wide">
                    <span>Bridge Session</span>
                    <select
                      value={messageBridgeSelectedSessionKey}
                      onChange={(event) => setMessageBridgeSelectedSessionKey(event.target.value)}
                      disabled={messageBridgeLoading || messageBridgeSaving || messageBridgeSessions.length === 0}
                    >
                      {messageBridgeSessions.length === 0 ? <option value="">No Feishu sessions</option> : null}
                      {messageBridgeSessions.map((item) => (
                        <option
                          key={item.external_session_key}
                          value={item.external_session_key}
                          title={item.external_session_key}
                        >
                          {formatMessageBridgeSessionLabel(item)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="mio-advanced-mini"
                    onClick={() => void handleMessageBridgeBindingSwitch()}
                    disabled={
                      messageBridgeLoading ||
                      messageBridgeSaving ||
                      !messageBridgeStatus ||
                      !messageBridgeSelectedSessionKey ||
                      (messageBridgeSelectedSessionKey === messageBridgeStatus.binding?.external_session_key &&
                        messageBridgeStatus.binding?.local_session_id === chatSessionId)
                    }
                  >
                    {messageBridgeSaving
                      ? "Switching..."
                      : messageBridgeSelectedSessionKey === messageBridgeStatus?.binding?.external_session_key
                        ? "Open Bridge Chat"
                        : "Switch Bridge Session"}
                  </button>
                </div>
                <div className="mio-settings-grid">
                  <label className="mio-advanced-field mio-advanced-toggle">
                    <span>Bridge Enabled</span>
                    <input
                      type="checkbox"
                      checked={messageBridgeStatus?.enabled ?? true}
                      onChange={(event) => void handleMessageBridgeSettingChange({ enabled: event.target.checked })}
                      disabled={messageBridgeLoading || messageBridgeSaving || !messageBridgeStatus}
                    />
                  </label>
                  <label className="mio-advanced-field mio-advanced-toggle">
                    <span>Realtime Drive Character</span>
                    <input
                      type="checkbox"
                      checked={messageBridgeStatus?.realtime_drive_character ?? true}
                      onChange={(event) =>
                        void handleMessageBridgeSettingChange({ realtime_drive_character: event.target.checked })
                      }
                      disabled={messageBridgeLoading || messageBridgeSaving || !messageBridgeStatus}
                    />
                  </label>
                </div>
              </section>

              <div className="mio-settings-actions">
                <button
                  type="button"
                  className="mio-advanced-mini"
                  onClick={() => void handleOpenClawTest()}
                  disabled={openClawLoading || openClawSaving || openClawTesting}
                >
                  {openClawTesting ? "Testing..." : "Test Connection"}
                </button>
                <button
                  type="button"
                  className="mio-advanced-mini"
                  onClick={resetOpenClawDraft}
                  disabled={openClawLoading || openClawSaving || cleanupBusy}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="mio-advanced-mini"
                  onClick={() => void handleMessageServiceCleanup()}
                  disabled={openClawLoading || openClawSaving || cleanupBusy}
                >
                  {cleanupBusy ? "Cleaning..." : "Cleanup"}
                </button>
                <button
                  type="button"
                  className="mio-advanced-mini is-active"
                  onClick={() => void handleOpenClawSave()}
                  disabled={openClawLoading || openClawSaving || cleanupBusy}
                >
                  {openClawSaving ? "Saving..." : "Save"}
                </button>
              </div>

              {openClawHealth ? (
                <section className="mio-settings-diagnostics" aria-label="OpenClaw diagnostics">
                  <div className="mio-settings-diagnostics-head">
                    <strong>{openClawHealth.ok ? "Runtime OK" : "Runtime Error"}</strong>
                    <span>{openClawHealth.base_url}</span>
                  </div>
                  <div className="mio-settings-meta">
                    <span>Agent: {openClawHealth.agent_id || "main"}</span>
                    <span>Model: {openClawHealth.model || "-"}</span>
                    <span>SSL: {openClawHealth.verify_ssl ? "On" : "Off"}</span>
                  </div>
                  <div className="mio-settings-probes">
                    {Object.entries(openClawHealth.probes || {}).map(([key, probe]) => (
                      <div key={key} className="mio-settings-probe">
                        <strong>{key}</strong>
                        <span>
                          {probe.status_code ?? "--"} · {probe.detail}
                        </span>
                      </div>
                    ))}
                  </div>
                  {openClawHealth.recommendations?.length ? (
                    <div className="mio-settings-recommendations">
                      {openClawHealth.recommendations.map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                  ) : null}
                </section>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}

      <div className="mio-layout" data-testid="mio-layout">
        <aside
          className={`mio-sidebar${isSidebarCollapsed ? " is-collapsed" : ""}`}
          data-testid="mio-sidebar"
          aria-label={"\u4e3b\u5bfc\u822a"}
        >
          <button
            className="mio-panel-toggle"
            type="button"
            aria-label={isSidebarCollapsed ? "展开左侧菜单" : "收起左侧菜单"}
            aria-pressed={isSidebarCollapsed}
            onClick={() => setIsSidebarCollapsed((current) => !current)}
          >
            {isSidebarCollapsed ? "›" : "‹"}
          </button>
          {navIcons.map((icon) => (
            <button
              key={icon.label}
              className={`mio-nav-button ${activeRightPanelView === icon.view ? "is-active" : ""}`}
              type="button"
              aria-label={icon.label}
              aria-pressed={activeRightPanelView === icon.view}
              onClick={() => handleRightPanelViewChange(icon.view)}
            >
              <span className="mio-nav-glyph" aria-hidden="true">
                {renderSidebarIcon(icon.key)}
              </span>
            </button>
          ))}

          <button
            className={`mio-nav-button is-bottom${isOpenClawSettingsOpen ? " is-active" : ""}`}
            type="button"
            aria-label={"\u8bbe\u7f6e"}
            aria-pressed={isOpenClawSettingsOpen}
            onClick={openOpenClawSettings}
          >
            <span className="mio-nav-glyph" aria-hidden="true">
              {renderSidebarIcon("settings")}
            </span>
          </button>
        </aside>

        <div className="mio-stage-wrap" data-testid="mio-stage-wrap">
          <div className="mio-orbit mio-orbit-one" />
          <div className="mio-orbit mio-orbit-two" />
          <section className="mio-dialogue" data-testid="mio-dialogue" aria-label={"\u4e3b\u5bf9\u8bdd\u6c14\u6ce1"}>
            <div className="mio-dialogue-chrome" aria-hidden="true">
              <svg viewBox="0 0 420 248" preserveAspectRatio="none" focusable="false">
                <path
                  className="mio-dialogue-glow"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-fill"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-outline-soft"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-outline"
                  d="M30 12H309C329 12 345 28 345 48V149C345 160 350 169 360 177L380 193L352 193C344 193 337 196 332 201L313 220C306 227 296 231 286 231H30C19 231 12 224 12 213V30C12 19 19 12 30 12Z"
                />
                <path
                  className="mio-dialogue-highlight"
                  d="M41 20H303C319 20 331 32 331 47V60"
                />
                <path
                  className="mio-dialogue-tail-highlight"
                  d="M347 164C351 171 357 176 365 181"
                />
              </svg>
            </div>
            <div className="mio-dialogue-head">
              <span className="mio-dialogue-name">MIO</span>
              <span className="mio-dialogue-wave" aria-hidden="true">
                <svg viewBox="0 0 120 16" focusable="false">
                  <path d="M2 8h11m5 0h4m5 0h2l2-3 2 6 3-10 3 13 3-8h2l2 3h4m5 0h4l2-4 2 8 3-12 3 10 2-5h4m7 0h28" />
                </svg>
              </span>
              {latestAssistantMessage?.tts ? (
                <button
                  type="button"
                  className="mio-dialogue-voice-button"
                  aria-label={
                    latestAssistantMessage.tts.status === "loading" || latestAssistantMessage.tts.status === "pending"
                      ? "Voice pending"
                      : latestAssistantMessage.tts.status === "failed" || latestAssistantMessage.tts.status === "partial_failed"
                        ? "Voice unavailable"
                        : latestAssistantMessage.tts.status === "expired"
                          ? "Voice expired"
                        : "Play voice"
                  }
                  title={
                    latestAssistantMessage.tts.status === "loading" || latestAssistantMessage.tts.status === "pending"
                      ? "Voice pending"
                      : latestAssistantMessage.tts.status === "failed" || latestAssistantMessage.tts.status === "partial_failed"
                        ? "Voice unavailable"
                        : latestAssistantMessage.tts.status === "expired"
                          ? "Voice expired"
                        : "Play voice"
                  }
                  disabled={latestAssistantMessage.tts.status !== "ready"}
                  data-status={latestAssistantMessage.tts.status}
                  data-active={latestAssistantMessage.id && latestAssistantMessage.id === activeTtsMessageId ? "true" : "false"}
                  onClick={() => playMessageAudio(latestAssistantMessage)}
                >
                  <svg viewBox="0 0 20 20" focusable="false" aria-hidden="true">
                    <path d="M4.2 8.2h2.5l3.4-3v9.6l-3.4-3H4.2z" />
                    <path d="M13.1 7.2a4 4 0 0 1 0 5.6M15.2 5.1a7 7 0 0 1 0 9.8" />
                  </svg>
                </button>
              ) : null}
            </div>
            <div className="mio-dialogue-copy" aria-live="polite">
              <p>{latestAssistantMessageText}</p>
            </div>
            <div className="mio-dialogue-dots" aria-hidden="true">
              <span />
              <span />
              <span />
              <span />
            </div>
          </section>
          <MMDStage
            ref={stageRef}
            chrome="bare"
            interaction={interaction}
            speaking={speaking}
            onInteractionComplete={handleStageInteractionComplete}
            models={models}
            selectedModelPath={selectedModelPath}
            modelUrl={selectedModel?.url || ""}
            modelLabel={selectedModel ? getModelDisplayLabel(selectedModel) : ""}
            renderPipeline={renderPipeline}
            cameraSnapshot={activeCameraSnapshot}
            onModelChange={handleCharacterSwitch}
          />
          <div className="mio-stage-bottom-fade" data-testid="mio-stage-bottom-fade" aria-hidden="true" />
        </div>

        <CompanionRightRail
          collapsed={isRightRailCollapsed}
          activeView={activeRightPanelView}
          sessions={chatSessions}
          activeSessionId={chatSessionId}
          sessionBusy={sessionBusy}
          messages={messages}
          loading={loading || chatBootstrapping}
          error={error}
          ttsEnabled={ttsEnabled}
          activeTtsMessageId={activeTtsMessageId}
          nextSteps={nextSteps}
          memoryNotes={memoryNotes}
          traceRows={traceRows}
          onToggleCollapsed={() => setIsRightRailCollapsed((current) => !current)}
          onCreateSession={handleCreateSession}
          onSelectSession={(sessionId) => void handleSelectSession(sessionId)}
          onRenameSession={(target) => void handleRenameSession(target)}
          onDeleteSession={(target) => void handleDeleteSession(target)}
          onPlayTtsMessage={playMessageAudio}
        />
      </div>
      <CompanionCommandBar
        input={input}
        inputLabel={INPUT_LABEL}
        loading={loading || chatBootstrapping}
        sendDisabled={!session || !chatSessionId || !input.trim() || chatBootstrapping}
        error={error}
        ttsEnabled={ttsEnabled}
        ttsMode={ttsMode}
        isAdvancedPanelOpen={isAdvancedPanelOpen}
        advancedPanel={
          isAdvancedPanelOpen ? (
            <section
              id="mio-advanced-panel"
              className="mio-advanced-panel"
              data-testid="mio-advanced-panel"
              role="dialog"
              aria-modal="false"
              aria-label={"\u9ad8\u7ea7\u529f\u80fd"}
            >
              <header className="mio-advanced-panel-head">
                <div>
                  <strong>{"\u9ad8\u7ea7\u529f\u80fd"}</strong>
                  <span>{"\u7edf\u4e00\u7ba1\u7406\u6a21\u578b\u3001\u6e32\u67d3\u6a21\u5f0f\u3001VMD \u5bfc\u5165\u4e0e MMD \u76f8\u673a\u3002"}</span>
                </div>
                <button
                  type="button"
                  className="mio-advanced-close"
                  aria-label="Close advanced panel"
                  onClick={() => {
                    setIsAdvancedPanelOpen(false);
                    closeRenameDialog();
                  }}
                >
                  ×
                </button>
              </header>

              <div className="mio-advanced-panel-scroll">
                <section
                  className="mio-advanced-stage"
                  data-testid="mio-advanced-stage"
                  aria-label={"\u6a21\u578b\u4e0e\u6e32\u67d3\u8bbe\u7f6e"}
                >
                  <div className="mio-camera-controls-head">
                    <div>
                      <strong>{"\u821e\u53f0\u8bbe\u7f6e"}</strong>
                      <span>
                        {selectedModel ? getModelDisplayLabel(selectedModel) : "\u672a\u9009\u62e9\u89d2\u8272"} · {renderPipeline}
                      </span>
                    </div>
                    <span>{models.length.toString().padStart(2, "0")} MODELS</span>
                  </div>

                  <label className="mio-advanced-field mio-advanced-field-wide">
                    <span>{"\u6a21\u578b\u5207\u6362"}</span>
                    <select
                      aria-label={"\u6a21\u578b\u5207\u6362"}
                      value={selectedModel?.relative_path || ""}
                      onChange={(event) => handleCharacterSwitch(event.target.value)}
                      disabled={models.length === 0}
                    >
                      {models.length === 0 ? <option value="">No models available</option> : null}
                      {models.map((model) => (
                        <option key={model.relative_path} value={model.relative_path}>
                          {getModelDisplayLabel(model)}
                        </option>
                      ))}
                    </select>
                  </label>

                  <div className="mio-pipeline-options" role="radiogroup" aria-label={"\u6e32\u67d3\u6a21\u5f0f"}>
                    {renderPipelineOptions.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        className={`mio-pipeline-option ${renderPipeline === option.value ? "is-active" : ""}`}
                        role="radio"
                        aria-checked={renderPipeline === option.value}
                        onClick={() => handleRenderPipelineChange(option.value)}
                      >
                        <strong>{option.label}</strong>
                        <span>{option.description}</span>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="mio-camera-controls" data-testid="mio-camera-controls" aria-label="MMD camera controls">
                  <div className="mio-camera-controls-head">
                    <div>
                      <strong>MMD Camera</strong>
                      <span>
                        {activeFavoriteVmdAsset
                          ? `Linked to ${activeFavoriteVmdAsset.display_name || activeFavoriteVmdAsset.filename}`
                          : activeCameraSnapshot
                            ? `Saved for ${renderPipeline}`
                            : `Default ${renderPipeline} camera`}
                      </span>
                    </div>
                    <span className={cameraEditMode ? "is-editing" : ""} data-testid="mio-camera-mode">
                      {cameraEditMode ? "Editing" : activeCameraSnapshot?.locked ? "Locked" : "Free"}
                    </span>
                  </div>
                  <p>Move the stage camera, then save this framing in the current session.</p>
                  <div className="mio-camera-actions">
                    <button
                      type="button"
                      className="mio-advanced-mini"
                      data-testid="mio-camera-unlock"
                      onClick={handleUnlockMmdCamera}
                      disabled={cameraEditMode}
                    >
                      Move Camera
                    </button>
                    <button
                      type="button"
                      className="mio-advanced-mini is-active"
                      data-testid="mio-camera-save"
                      onClick={handleSaveMmdCamera}
                    >
                      Save Camera
                    </button>
                    <button
                      type="button"
                      className="mio-advanced-mini"
                      data-testid="mio-camera-reset"
                      onClick={handleResetMmdCamera}
                    >
                      Reset
                    </button>
                  </div>
                </section>

                <div className="mio-advanced-toolbar">
                  <label className="mio-advanced-field">
                    <span>Emotion Slot</span>
                    <select
                      value={advancedSlot}
                      onChange={(event) => setAdvancedSlot(event.target.value as (typeof EMOTION_SLOTS)[number])}
                      disabled={advancedBusy}
                    >
                      {EMOTION_SLOTS.map((slot) => (
                        <option key={slot} value={slot}>
                          {slot}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="mio-advanced-field">
                    <span>Playback Rate</span>
                    <input
                      type="number"
                      min="0.1"
                      max="4"
                      step="0.1"
                      value={advancedPlaybackRate}
                      onChange={(event) => setAdvancedPlaybackRate(event.target.value)}
                      disabled={advancedBusy}
                    />
                  </label>

                  <label className={`mio-advanced-upload ${advancedBusy ? "is-busy" : ""}`}>
                    <span>{advancedBusy ? "Importing..." : "Import VMD"}</span>
                    <input
                      type="file"
                      accept=".vmd"
                      multiple
                      disabled={advancedBusy}
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void handleAdvancedUpload(event.target.files);
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <label className={`mio-advanced-upload ${advancedBusy ? "is-busy" : ""}`}>
                    <span>{advancedBusy ? "Importing..." : "Import Folder"}</span>
                    <input
                      type="file"
                      accept=".vmd"
                      multiple
                      {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
                      disabled={advancedBusy}
                      onChange={(event) => {
                        if (event.target.files?.length) {
                          void handleAdvancedUpload(event.target.files);
                        }
                        event.currentTarget.value = "";
                      }}
                    />
                  </label>
                  <button
                    type="button"
                    className="mio-advanced-mini"
                    onClick={() => void handleExportMotionContext()}
                    disabled={advancedBusy || !selectedModel?.relative_path}
                  >
                    Export Motion Context
                  </button>
                </div>

                {latestMotionContextExport ? (
                  <div className="mio-advanced-empty">
                    <p>
                      Motion context ready: {latestMotionContextExport.motion_count} favorite motion(s) for{" "}
                      {latestMotionContextExport.model_display_name}.
                    </p>
                    <pre className="mio-advanced-json-preview" data-testid="mio-motion-context-json">
                      {JSON.stringify(latestMotionContextExport.export_json, null, 2)}
                    </pre>
                  </div>
                ) : null}

                <section className="mio-advanced-library">
                  <div className="mio-advanced-tabs" role="tablist" aria-label="VMD asset views">
                    <button
                      type="button"
                      className={`mio-advanced-tab ${advancedTab === "library" ? "is-active" : ""}`}
                      role="tab"
                      aria-selected={advancedTab === "library"}
                      onClick={() => {
                        setAdvancedTab("library");
                        setAdvancedFavoriteSlotFilter("all");
                      }}
                    >
                      Library
                    </button>
                    <button
                      type="button"
                      className={`mio-advanced-tab ${advancedTab === "favorites" ? "is-active" : ""}`}
                      role="tab"
                      aria-selected={advancedTab === "favorites"}
                      onClick={() => setAdvancedTab("favorites")}
                    >
                      Favorites
                    </button>
                  </div>

                  {advancedError ? <p className="mio-advanced-error">{advancedError}</p> : null}
                  {advancedMessage && !advancedError ? <p className="mio-advanced-empty">{advancedMessage}</p> : null}

                  <div className="mio-advanced-list">
                    <div className="mio-advanced-list-head">
                      <span>{advancedTab === "library" ? "Recent VMD Assets" : "Current Model Favorites"}</span>
                      <strong>
                        {(advancedTab === "library" ? visibleRecentVmdAssets.length : filteredFavoriteAssets.length)
                          .toString()
                          .padStart(2, "0")}
                      </strong>
                    </div>

                    {advancedTab === "favorites" ? (
                      <label className="mio-advanced-filter">
                        <span>Favorite Slot Filter</span>
                        <select
                          aria-label="Favorite slot filter"
                          value={advancedFavoriteSlotFilter}
                          onChange={(event) =>
                            setAdvancedFavoriteSlotFilter(event.target.value as "all" | (typeof EMOTION_SLOTS)[number])
                          }
                          disabled={advancedBusy}
                        >
                          <option value="all">All slots</option>
                          {EMOTION_SLOTS.map((slot) => (
                            <option key={slot} value={slot}>
                              {slot}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}

                    <div className="mio-advanced-list-scroll">
                      {(advancedTab === "library" ? visibleRecentVmdAssets : filteredFavoriteAssets).length === 0 ? (
                        <p className="mio-advanced-empty">
                          {advancedTab === "library"
                            ? "No VMD assets are ready for preview yet."
                            : "No favorited VMD assets match this slot filter."}
                        </p>
                      ) : (
                        (advancedTab === "library" ? visibleRecentVmdAssets : filteredFavoriteAssets).map((asset) => (
                          <div key={asset.asset_id} className="mio-advanced-asset" data-testid="mio-advanced-asset">
                            <button
                              type="button"
                              className="mio-advanced-asset-preview"
                              onClick={() => previewVmdAsset(asset)}
                            >
                              <span className="mio-advanced-asset-copy">
                                <strong>{asset.display_name || asset.filename}</strong>
                                <small>
                                  {asset.slot} · {(asset.size_bytes / 1024).toFixed(1)} KB
                                </small>
                              </span>
                              <span className="mio-advanced-asset-action">Preview</span>
                            </button>
                            <div className="mio-advanced-asset-tools">
                              <button
                                type="button"
                                className={`mio-advanced-mini ${asset.is_favorite ? "is-active" : ""}`}
                                onClick={() => handleFavoriteAsset(asset)}
                                disabled={advancedBusy || !selectedModel?.relative_path}
                              >
                                {asset.is_favorite ? "Unfavorite" : "Favorite"}
                              </button>
                              <button
                                type="button"
                                className="mio-advanced-mini"
                                onClick={() => openRenameDialog(asset)}
                                disabled={advancedBusy}
                              >
                                Rename
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </section>
              </div>

              {renameTarget ? (
                <div className="mio-rename-scrim">
                  <div
                    className="mio-rename-dialog"
                    data-testid="mio-rename-dialog"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="mio-rename-title"
                    onKeyDown={handleRenameDialogKeyDown}
                  >
                    <div className="mio-rename-copy">
                      <strong id="mio-rename-title">Rename Motion</strong>
                      <span>{renameTarget.filename}</span>
                    </div>
                    <input
                      className="mio-rename-input"
                      data-testid="mio-rename-input"
                      value={renameDraft}
                      onChange={(event) => setRenameDraft(event.target.value)}
                      placeholder="Enter motion name"
                      autoFocus
                    />
                    <div className="mio-rename-actions">
                      <button type="button" className="mio-advanced-mini" onClick={closeRenameDialog} disabled={advancedBusy}>
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="mio-advanced-mini is-active"
                        onClick={() => void handleRenameAssetConfirm()}
                        disabled={advancedBusy}
                      >
                        Confirm
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null
        }
        onSubmit={onSubmit}
        onInputChange={setInput}
        onTtsEnabledChange={setTtsEnabled}
        onTtsModeChange={setTtsMode}
        onAdvancedToggle={() => {
          setIsAdvancedPanelOpen((open) => !open);
          setAdvancedError("");
          setAdvancedTab("library");
          setAdvancedFavoriteSlotFilter("all");
        }}
      />
      <div className="mio-toast-layer" aria-live="polite" aria-atomic="true">
        {toast ? (
          <div className="mio-toast" role="status">
            {toast.message}
          </div>
        ) : null}
      </div>
    </main>
  );
}

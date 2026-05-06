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
  getOpenClawConfig,
  getOpenClawHealth,
  getResolvedMappings,
  listMmdModels,
  listVmdAssets,
  postChat,
  putOpenClawConfig,
  requestServerTts,
  updateVmdAsset,
  uploadVmdAsset,
} from "@/lib/api";
import { clearSession, loadSession, saveSession } from "@/lib/session";
import { DEFAULT_TTS_MODE, playServerTtsAudio } from "@/lib/ttsPlayback.js";
import type {
  ChatMessage,
  MappingConfig,
  MmdCameraSnapshot,
  MmdModelAsset,
  OpenClawConfig,
  OpenClawHealthStatus,
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

const SPRITE = "/images/sprite-sliced";
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

function buildFavoriteVmdCameraKey(pipeline: RenderPipeline, modelPath: string, assetId: string) {
  return `${pipeline}::${encodeURIComponent(modelPath)}::${encodeURIComponent(assetId)}`;
}

export default function CompanionPage() {
  const router = useRouter();
  const stageRef = useRef<MMDStageHandle | null>(null);
  const serverAudioRef = useRef<HTMLAudioElement | null>(null);
  const serverAudioCleanupRef = useRef<(() => void) | null>(null);
  const ignoreNextStageCompletionResetRef = useRef(false);
  const [session, setSession] = useState<UserSession | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      role: "assistant",
      content: DEFAULT_ASSISTANT_COPY,
    },
  ]);
  const [input, setInput] = useState("");
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

    Promise.all([getResolvedMappings(session.userId), listVmdAssets(session.userId), listMmdModels()])
      .then(([mappingRows, assetRows, modelRows]) => {
        setMappings(mappingRows);
        setAssets(assetRows);
        setModels(modelRows);
        setSelectedModelPath((current) => {
          if (current && modelRows.some((item) => item.relative_path === current)) {
            return current;
          }
          const preferred =
            modelRows.find((item) => item.relative_path.includes(DEFAULT_MODEL_RELATIVE_PATH)) ||
            pickInitialModelSelection(modelRows, DEFAULT_MODEL_RELATIVE_PATH);
          return preferred?.relative_path || "";
        });
      })
      .catch((err: Error) => {
        setError(err.message);
      });
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

  useEffect(() => {
    if (!session) return;
    void loadOpenClawConfig({ silent: true });
  }, [loadOpenClawConfig, session]);

  useEffect(() => {
    if (!isOpenClawSettingsOpen || !session) return;
    void loadOpenClawConfig();
  }, [isOpenClawSettingsOpen, loadOpenClawConfig, session]);

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

  const filteredFavoriteAssets = useMemo(() => {
    if (advancedFavoriteSlotFilter === "all") return currentModelFavoriteAssets;
    return currentModelFavoriteAssets.filter((asset) => asset.slot === advancedFavoriteSlotFilter);
  }, [advancedFavoriteSlotFilter, currentModelFavoriteAssets]);

  const autoFavoriteInteraction = useMemo<InteractionState | null>(() => {
    return buildAutoFavoriteInteraction(currentModelFavoriteAssets) as InteractionState | null;
  }, [currentModelFavoriteAssets]);

  const autoplayResumeInteraction = useMemo<InteractionState | null>(() => {
    return buildAutoplayResumeInteraction(currentModelFavoriteAssets) as InteractionState | null;
  }, [currentModelFavoriteAssets]);

  const activeFavoriteVmdAsset = useMemo(() => {
    if (!activeVmdAssetId) return null;
    return currentModelFavoriteAssets.find((asset) => asset.asset_id === activeVmdAssetId) || null;
  }, [activeVmdAssetId, currentModelFavoriteAssets]);

  const activeFavoriteVmdCameraKey =
    activeFavoriteVmdAsset && selectedModel?.relative_path
      ? buildFavoriteVmdCameraKey(renderPipeline, selectedModel.relative_path, activeFavoriteVmdAsset.asset_id)
      : "";

  const latestAssistantMessage =
    [...messages].reverse().find((item) => item.role === "assistant")?.content || DEFAULT_ASSISTANT_COPY;
  const activeCameraSnapshot =
    (activeFavoriteVmdCameraKey ? session?.mmdCameraByFavoriteVmd?.[activeFavoriteVmdCameraKey] : null) ??
    session?.mmdCamera?.[renderPipeline] ??
    null;

  useEffect(() => {
    if (!autoFavoriteInteraction) return;
    if (interactionSource !== "default" && interactionSource !== "autoplay") return;
    setInteraction(autoFavoriteInteraction);
    setInteractionSource("autoplay");
    setActiveVmdAssetId(currentModelFavoriteAssets[0]?.asset_id || "");
    setPendingAutoResume(false);
  }, [autoFavoriteInteraction, currentModelFavoriteAssets, interactionSource, selectedModel?.relative_path]);

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
    return () => stopServerAudio({ updateSpeaking: false });
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
      setOpenClawMessage(saved.message);
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

  async function playServerAudio(audioBlob: Blob) {
    stopSpeechPlayback();
    const controller = await playServerTtsAudio(audioBlob, {
      setSpeaking: (value?: boolean) => setSpeaking(Boolean(value)),
      onCleanup: ({ audio }: { audio?: HTMLAudioElement } = {}) => {
        if (audio && serverAudioRef.current === audio) {
          serverAudioRef.current = null;
          serverAudioCleanupRef.current = null;
        }
      },
    });
    serverAudioRef.current = controller.audio as HTMLAudioElement;
    serverAudioCleanupRef.current = controller.cleanup;
  }

  function browserSpeak(text: string) {
    stopServerAudio();
    if (!("speechSynthesis" in window)) {
      handleTtsFailure("当前环境不支持浏览器语音播放。");
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = 1.03;
    utter.pitch = 1.08;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => {
      setSpeaking(false);
      handleTtsFailure("浏览器语音播放失败。");
    };
    try {
      window.speechSynthesis.speak(utter);
    } catch {
      setSpeaking(false);
      handleTtsFailure("浏览器语音播放失败。");
    }
  }

  async function speak(text: string) {
    if (!ttsEnabled || !session) return;
    if (ttsMode === "browser") {
      browserSpeak(text);
      return;
    }
    const result = await requestServerTts(session.userId, text, sessionId);
    if (!result.configured) {
      browserSpeak(text);
      return;
    }
    await playServerAudio(result.audio);
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session || !input.trim() || loading) return;

    const userText = input.trim();
    const historyMessages = [...messages, { role: "user", content: userText } satisfies ChatMessage];
    ignoreNextStageCompletionResetRef.current = false;
    setInput("");
    setError("");
    setLoading(true);
    setMessages(historyMessages);
    const traceId = crypto.randomUUID();

    try {
      const response = await postChat(
        {
          user_id: session.userId,
          message: userText,
          session_id: sessionId,
          history: makeHistory(historyMessages),
        },
        traceId,
      );

      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.text,
          traceId: response.trace_id,
        },
      ]);

      const plan = resolvePlaybackPlan({
        slot: response.emotion,
        action: response.action,
        motionPlan: response.motion_plan,
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
          emotion: response.emotion,
          action: response.action,
          mode: "vmd",
          vmdUrl: plan.url,
          vmdLoopUrls: [],
          vmdLoopEmotionByUrl: plan.url ? { [plan.url]: response.emotion } : {},
          playbackRate: resolveVmdPlaybackRate(plannedAsset || { url: plan.url }),
          sequence: [],
        });
      } else {
        setInteractionSource("chat");
        setActiveVmdAssetId("");
        setPendingAutoResume(Boolean(autoplayResumeInteraction));
        setInteraction({
          emotion: response.emotion,
          action: plan.action,
          mode: "procedural",
          vmdUrl: "",
          vmdLoopEmotionByUrl: {},
          playbackRate: 1,
          sequence: plan.sequence || [],
        });
      }

      try {
        await speak(response.text);
      } catch (speakError) {
        handleTtsFailure(speakError instanceof Error ? `语音播放失败：${speakError.message}` : "语音播放失败。");
      }
    } catch (err) {
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
      <MioModeBackground active={renderPipeline === "mio-reference"} />
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
            <span>SESSION: {sessionId.slice(0, 6).toUpperCase()}</span>
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
                  disabled={openClawLoading || openClawSaving}
                >
                  Reset
                </button>
                <button
                  type="button"
                  className="mio-advanced-mini is-active"
                  onClick={() => void handleOpenClawSave()}
                  disabled={openClawLoading || openClawSaving}
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
            </div>
            <p>{latestAssistantMessage}</p>
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
          messages={messages}
          loading={loading}
          error={error}
          ttsEnabled={ttsEnabled}
          nextSteps={nextSteps}
          memoryNotes={memoryNotes}
          traceRows={traceRows}
          onToggleCollapsed={() => setIsRightRailCollapsed((current) => !current)}
        />
      </div>
      <CompanionCommandBar
        input={input}
        inputLabel={INPUT_LABEL}
        loading={loading}
        sendDisabled={!session || !input.trim()}
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
                </div>

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

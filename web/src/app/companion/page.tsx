"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
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
import {
  DEFAULT_VMD_PLAYBACK_RATE,
} from "@/features/stage/builtInMotionPreferences.js";
import { getModelDisplayLabel, pickInitialModelSelection } from "@/features/stage/modelCatalog.js";
import { collectImportableVmdFiles } from "@/features/stage/vmdImportHelpers.js";
import {
  getResolvedMappings,
  listMmdModels,
  listVmdAssets,
  postChat,
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
  standbyVmdUrl?: string;
  loopGapMs?: number;
  loopMode?: "random" | "sequential";
  playbackRate?: number;
  sequence: InteractionStep[];
};

type InteractionSource = "default" | "autoplay" | "manual-preview" | "chat";
type ToastState = { id: number; message: string } | null;

const SPRITE = "/images/sprite-sliced";
const DEFAULT_MODEL_RELATIVE_PATH = "优菈.pmx";
const DEFAULT_ASSISTANT_COPY =
  "\u6211\u7406\u89e3\u4f60\u7684\u9700\u6c42\u4e86\uff5e\n\u6b63\u5728\u5e2e\u4f60\u62c6\u89e3\u4efb\u52a1\u5e76\u89c4\u5212\u6b65\u9aa4\uff01";
const INPUT_LABEL =
  "\u8f93\u5165\u4f60\u7684\u6307\u4ee4 / \u4efb\u52a1 / \u95ee\u9898...\uff08Enter \u53d1\u9001\uff0cShift + Enter \u6362\u884c\uff09";

function normalizeRenderPipeline(value?: string): RenderPipeline {
  if (value === "classic" || value === "hero-shot" || value === "genshin") return value;
  return "classic";
}

const navIcons = [
  { src: "asset-004.png", label: "\u83dc\u5355" },
  { src: "asset-005.png", label: "\u5bf9\u8bdd", active: true },
  { src: "asset-006.png", label: "\u4efb\u52a1" },
  { src: "asset-007.png", label: "\u5de5\u5177" },
  { src: "asset-008.png", label: "\u8bb0\u5fc6" },
  { src: "asset-009.png", label: "\u80fd\u529b" },
];

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
    standbyVmdUrl: "",
    loopGapMs: 0,
    loopMode: "random",
    playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
    sequence: [],
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
  const [renderPipeline, setRenderPipeline] = useState<RenderPipeline>("classic");
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

  useEffect(() => {
    const saved = loadSession();
    const normalizedPipeline = normalizeRenderPipeline(saved?.renderPipeline);
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

  async function handleRenameAssetSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
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
    <main className="mio-hud" data-testid="mio-hud" data-render-pipeline={renderPipeline}>
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
          <span>USER: {session.userId}</span>
          <span>SESSION: {sessionId.slice(0, 6).toUpperCase()}</span>
          <Link href="/traces" className="mio-trace-button">
            TRACE
          </Link>
          <button
            className="mio-icon-button"
            type="button"
            onClick={() => {
              clearSession();
              router.push("/");
            }}
            aria-label={"\u9000\u51fa\u767b\u5f55"}
          >
            <img src={`${SPRITE}/asset-010.png`} alt="" />
          </button>
          <div className="mio-avatar-stack">
            <img className="mio-avatar" src={`${SPRITE}/asset-030.png`} alt={"\u5f53\u524d\u89d2\u8272\u5934\u50cf"} />
          </div>
        </div>
      </header>

      <aside className="mio-sidebar" data-testid="mio-sidebar" aria-label={"\u4e3b\u5bfc\u822a"}>
        {navIcons.map((icon) => (
          <button
            key={icon.label}
            className={`mio-nav-button ${icon.active ? "is-active" : ""}`}
            type="button"
            aria-label={icon.label}
          >
            <img src={`${SPRITE}/${icon.src}`} alt="" />
          </button>
        ))}

        <button className="mio-nav-button is-bottom" type="button" aria-label={"\u8bbe\u7f6e"}>
          <img src={`${SPRITE}/asset-010.png`} alt="" />
        </button>

      </aside>

      <div className="mio-stage-wrap" data-testid="mio-stage-wrap">
        <div className="mio-orbit mio-orbit-one" />
        <div className="mio-orbit mio-orbit-two" />
        <section className="mio-dialogue" data-testid="mio-dialogue" aria-label={"\u4e3b\u5bf9\u8bdd\u6c14\u6ce1"}>
          <div className="mio-dialogue-head">
            <span>MIO</span>
            <img src={`${SPRITE}/asset-075.png`} alt="" />
          </div>
          <p>{latestAssistantMessage}</p>
          <span className="mio-typing">....</span>
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
      </div>

      <section className="mio-right-rail" data-testid="mio-right-rail" aria-label={"\u72b6\u6001\u9762\u677f"}>
        <article className="mio-card">
          <h2>
            <img src={`${SPRITE}/asset-013.png`} alt="" />
            {"\u4e0b\u4e00\u6b65\u5efa\u8bae"} <small>NEXT STEPS</small>
          </h2>
          <ul className="mio-check-list">
            {nextSteps.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
          <button type="button">{"\u67e5\u770b\u66f4\u591a\u5efa\u8bae\uff086\uff09"}</button>
        </article>

        <article className="mio-card">
          <h2>
            <img src={`${SPRITE}/asset-008.png`} alt="" />
            {"\u8bb0\u5fc6\u6458\u8981"} <small>MEMORY</small>
          </h2>
          {memoryNotes.map((item) => (
            <p key={item}>{item}</p>
          ))}
          <button type="button">{"\u67e5\u770b\u5b8c\u6574\u8bb0\u5fc6"}</button>
        </article>

        <article className="mio-card mio-trace-card">
          <h2>
            <img src={`${SPRITE}/asset-022.png`} alt="" />
            {"Trace / \u8bf7\u6c42\u72b6\u6001"} <small>TRACE</small>
          </h2>
          <div className="mio-trace-list">
            {traceRows.map(([method, path, status, time]) => (
              <div key={`${method}-${path}`}>
                <span>{method}</span>
                <span>{path}</span>
                <strong>{status}</strong>
                <span>{time}</span>
              </div>
            ))}
          </div>
          <Link href="/traces">{"\u8fdb\u5165 Trace \u9875\u9762"}</Link>
        </article>
      </section>

      <div className="mio-stage-bottom-fade" data-testid="mio-stage-bottom-fade" aria-hidden="true" />
      {isAdvancedPanelOpen ? (
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

          {renameTarget ? (
            <div className="mio-rename-scrim">
              <form
                className="mio-rename-dialog"
                data-testid="mio-rename-dialog"
                onSubmit={handleRenameAssetSubmit}
              >
                <div className="mio-rename-copy">
                  <strong>Rename Motion</strong>
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
                  <button type="submit" className="mio-advanced-mini is-active" disabled={advancedBusy}>
                    Confirm
                  </button>
                </div>
              </form>
            </div>
          ) : null}
        </section>
      ) : null}
      <CompanionCommandBar
        input={input}
        inputLabel={INPUT_LABEL}
        loading={loading}
        error={error}
        ttsEnabled={ttsEnabled}
        ttsMode={ttsMode}
        isAdvancedPanelOpen={isAdvancedPanelOpen}
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

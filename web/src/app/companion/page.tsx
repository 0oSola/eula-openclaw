"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createVmdPreviewInteraction,
  resolveVmdPlaybackRate,
} from "@/features/mapping/vmdPreview.js";
import { resolvePlaybackPlan } from "@/features/mapping/resolveAction.js";
import { MMDStage } from "@/features/stage/MMDStage";
import {
  BUILT_IN_VMD_PLAYBACK_RATE,
  pickMotionFromPreset,
  resolveDefaultBuiltInMotionPresetForModel,
} from "@/features/stage/builtInMotionPreferences.js";
import { getModelDisplayLabel, pickInitialModelSelection } from "@/features/stage/modelCatalog.js";
import {
  getResolvedMappings,
  listMmdModels,
  listMmdMotions,
  listVmdAssets,
  postChat,
  requestServerTts,
} from "@/lib/api";
import { clearSession, loadSession, saveSession } from "@/lib/session";
import type { ChatMessage, MappingConfig, MmdModelAsset, MmdMotionAsset, UserSession, VmdAsset } from "@/lib/types";

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
  loopMode?: "random" | "sequential";
  playbackRate?: number;
  sequence: InteractionStep[];
};

type InteractionSource = "default" | "autoplay" | "manual-preview" | "chat";
type FavoriteCapableVmdAsset = VmdAsset & {
  display_name?: string;
  is_favorite?: boolean;
  favorite_model_relative_path?: string | null;
};

const SPRITE = "/images/sprite-sliced";
const DEFAULT_MODEL_RELATIVE_PATH = "GirlsFrontline NemesisGnosisDefault.pmx";
const DEFAULT_ASSISTANT_COPY =
  "\u6211\u7406\u89e3\u4f60\u7684\u9700\u6c42\u4e86\uff5e\n\u6b63\u5728\u5e2e\u4f60\u62c6\u89e3\u4efb\u52a1\u5e76\u89c4\u5212\u6b65\u9aa4\uff01";
const INPUT_LABEL =
  "\u8f93\u5165\u4f60\u7684\u6307\u4ee4 / \u4efb\u52a1 / \u95ee\u9898...\uff08Enter \u53d1\u9001\uff0cShift + Enter \u6362\u884c\uff09";

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

function makeHistory(messages: ChatMessage[]) {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content }));
}

function getCharacterBadge(index: number) {
  return `${index + 1}`.padStart(2, "0");
}

export default function CompanionPage() {
  const router = useRouter();
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
  const [interaction, setInteraction] = useState<InteractionState>({
    emotion: "neutral",
    action: "idle",
    mode: "procedural",
    vmdUrl: "",
    sequence: [],
  });
  const [mappings, setMappings] = useState<Record<string, MappingConfig>>({});
  const [assets, setAssets] = useState<VmdAsset[]>([]);
  const [models, setModels] = useState<MmdModelAsset[]>([]);
  const [motions, setMotions] = useState<MmdMotionAsset[]>([]);
  const [selectedModelPath, setSelectedModelPath] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsMode, setTtsMode] = useState<"browser" | "server">("browser");
  const [speaking, setSpeaking] = useState(false);
  const [renderPipeline, setRenderPipeline] = useState<"classic" | "genshin">("classic");
  const [isCharacterPickerOpen, setIsCharacterPickerOpen] = useState(false);
  const [isMotionPickerOpen, setIsMotionPickerOpen] = useState(false);
  const [interactionSource, setInteractionSource] = useState<InteractionSource>("default");
  const [pendingAutoResume, setPendingAutoResume] = useState(false);
  const autoIdlePresetKeyRef = useRef("");

  useEffect(() => {
    const saved = loadSession();
    setSession(saved);
    setRenderPipeline(saved?.renderPipeline || "classic");
  }, []);

  useEffect(() => {
    if (!session) return;

    Promise.all([getResolvedMappings(session.userId), listVmdAssets(session.userId), listMmdModels(), listMmdMotions()])
      .then(([mappingRows, assetRows, modelRows, motionRows]) => {
        setMappings(mappingRows);
        setAssets(assetRows);
        setModels(modelRows);
        setMotions(motionRows);
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

  const selectedModel = useMemo(() => {
    return (
      models.find((item) => item.relative_path === selectedModelPath) ||
      pickInitialModelSelection(models, DEFAULT_MODEL_RELATIVE_PATH)
    );
  }, [models, selectedModelPath]);

  const currentModelFavoriteAssets = useMemo(() => {
    if (!selectedModel?.relative_path) return [];
    return recentVmdAssets.filter(
      (asset) =>
        (asset as FavoriteCapableVmdAsset).is_favorite &&
        (asset as FavoriteCapableVmdAsset).favorite_model_relative_path === selectedModel.relative_path,
    );
  }, [recentVmdAssets, selectedModel?.relative_path]);

  const autoFavoriteInteraction = useMemo<InteractionState | null>(() => {
    return buildAutoFavoriteInteraction(currentModelFavoriteAssets) as InteractionState | null;
  }, [currentModelFavoriteAssets]);

  const autoplayResumeInteraction = useMemo<InteractionState | null>(() => {
    return buildAutoplayResumeInteraction(currentModelFavoriteAssets) as InteractionState | null;
  }, [currentModelFavoriteAssets]);

  const characterOptions = useMemo(() => {
    return models.map((model, index) => ({
      id: model.relative_path,
      path: model.relative_path,
      label: getModelDisplayLabel(model),
      badge: getCharacterBadge(index),
      active: model.relative_path === selectedModelPath,
    }));
  }, [models, selectedModelPath]);

  const defaultBuiltInMotionPreset = useMemo(() => {
    return resolveDefaultBuiltInMotionPresetForModel(selectedModel, motions);
  }, [selectedModel, motions]);

  useEffect(() => {
    autoIdlePresetKeyRef.current = "";
    setInteractionSource("default");
    setPendingAutoResume(false);
  }, [selectedModel?.relative_path]);

  useEffect(() => {
    if (autoFavoriteInteraction) return;
    if (!defaultBuiltInMotionPreset || !selectedModel?.relative_path) return;
    if (interactionSource !== "default") return;
    const applyKey = `${selectedModel.relative_path}:${defaultBuiltInMotionPreset.key}`;
    if (autoIdlePresetKeyRef.current === applyKey) return;
    const defaultMotion = pickMotionFromPreset(defaultBuiltInMotionPreset);
    if (!defaultMotion) return;

    autoIdlePresetKeyRef.current = applyKey;
    setInteraction((current) => {
      return {
        emotion: current.emotion || "neutral",
        action: defaultMotion.label,
        mode: "vmd",
        vmdUrl: defaultMotion.url,
        vmdLoopUrls: defaultBuiltInMotionPreset.motions.map((motion: MmdMotionAsset) => motion.url),
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: defaultBuiltInMotionPreset.playbackRate,
        sequence: [],
      };
    });
  }, [autoFavoriteInteraction, defaultBuiltInMotionPreset, interactionSource, selectedModel]);

  useEffect(() => {
    if (!autoFavoriteInteraction) return;
    if (!selectedModel?.relative_path) return;
    if (interactionSource !== "default" && interactionSource !== "autoplay") return;
    autoIdlePresetKeyRef.current = "";
    setInteraction(autoFavoriteInteraction);
    setInteractionSource("autoplay");
    setPendingAutoResume(false);
  }, [autoFavoriteInteraction, interactionSource, selectedModel?.relative_path]);

  useEffect(() => {
    if (autoFavoriteInteraction || interactionSource !== "autoplay") return;
    autoIdlePresetKeyRef.current = "";
    setInteractionSource("default");
    setPendingAutoResume(false);
  }, [autoFavoriteInteraction, interactionSource]);

  const latestAssistantMessage =
    [...messages].reverse().find((item) => item.role === "assistant")?.content || DEFAULT_ASSISTANT_COPY;

  function previewVmdAsset(asset: VmdAsset) {
    const preview = createVmdPreviewInteraction(asset);
    setInteractionSource("manual-preview");
    setPendingAutoResume(Boolean(autoplayResumeInteraction));
    setInteraction({
      emotion: preview.emotion,
      action: preview.action,
      mode: "vmd",
      vmdUrl: preview.vmdUrl,
      vmdLoopUrls: [],
      standbyVmdUrl: "",
      loopMode: "random",
      playbackRate: resolveVmdPlaybackRate(),
      sequence: preview.sequence,
    });
  }

  function previewBuiltInMotion(motion: MmdMotionAsset) {
    setInteractionSource("manual-preview");
    setPendingAutoResume(Boolean(autoplayResumeInteraction));
    setInteraction({
      emotion: interaction.emotion || "neutral",
      action: motion.label,
      mode: "vmd",
      vmdUrl: motion.url,
      vmdLoopUrls: [],
      standbyVmdUrl: "",
      loopMode: "random",
      playbackRate: BUILT_IN_VMD_PLAYBACK_RATE,
      sequence: [],
    });
    setIsMotionPickerOpen(false);
  }

  function handleRenderPipelineChange(nextPipeline: "classic" | "genshin") {
    setRenderPipeline(nextPipeline);
    if (!session) return;
    saveSession({ ...session, renderPipeline: nextPipeline });
  }

  function browserSpeak(text: string) {
    if (!("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = "zh-CN";
    utter.rate = 1.03;
    utter.pitch = 1.08;
    utter.onstart = () => setSpeaking(true);
    utter.onend = () => setSpeaking(false);
    utter.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utter);
  }

  async function speak(text: string) {
    if (!ttsEnabled || !session) return;
    if (ttsMode === "browser") {
      browserSpeak(text);
      return;
    }
    const result = await requestServerTts(session.userId, text);
    if (!result.configured) {
      browserSpeak(text);
    }
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (!session || !input.trim() || loading) return;

    const userText = input.trim();
    const historyMessages = [...messages, { role: "user", content: userText } satisfies ChatMessage];
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
        setInteractionSource("chat");
        setPendingAutoResume(Boolean(autoplayResumeInteraction));
        setInteraction({
          emotion: response.emotion,
          action: response.action,
          mode: "vmd",
          vmdUrl: plan.url,
          vmdLoopUrls: [],
          standbyVmdUrl: "",
          loopMode: "random",
          playbackRate: 1,
          sequence: [],
        });
      } else {
        setInteractionSource("chat");
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

      await speak(response.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "\u8bf7\u6c42\u5931\u8d25\u3002");
      setMessages((prev) => [
        ...prev,
        {
          role: "system",
          content: "\u53d1\u9001\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5 API \u670d\u52a1\u72b6\u6001\u548c\u914d\u7f6e\u3002",
        },
      ]);
      setInteraction({
        emotion: "caring",
        action: "comfort",
        mode: "procedural",
        vmdUrl: "",
        playbackRate: 1,
        sequence: [],
      });
    } finally {
      setLoading(false);
    }
  }

  function handleCharacterSwitch(nextPath: string) {
    autoIdlePresetKeyRef.current = "";
    setInteractionSource("default");
    setPendingAutoResume(false);
    setSelectedModelPath(nextPath);
    setIsCharacterPickerOpen(false);
  }

  function handleStageInteractionComplete() {
    if (pendingAutoResume && autoplayResumeInteraction) {
      setInteraction(autoplayResumeInteraction);
      setInteractionSource("autoplay");
      setPendingAutoResume(false);
      return;
    }

    autoIdlePresetKeyRef.current = "";
    setInteractionSource("default");
    setPendingAutoResume(false);
  }

  const activeMotionPath =
    interaction.mode === "vmd" ? motions.find((motion) => motion.url === interaction.vmdUrl)?.relative_path || "" : "";

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
            <div className="mio-avatar-meta">
              <strong>{selectedModel ? getModelDisplayLabel(selectedModel) : "MODEL"}</strong>
              <span>ACTIVE CHARACTER</span>
            </div>
          </div>
          <label
            style={{
              display: "grid",
              gap: "0.2rem",
              minWidth: "10rem",
              fontSize: "0.7rem",
              letterSpacing: "0.08em",
            }}
          >
            <span>PIPELINE</span>
            <select
              aria-label="Render pipeline"
              value={renderPipeline}
              onChange={(event) => handleRenderPipelineChange(event.target.value as "classic" | "genshin")}
              style={{
                minHeight: "2.2rem",
                borderRadius: "999px",
                border: "1px solid rgba(140, 209, 255, 0.24)",
                background: "rgba(9, 18, 31, 0.82)",
                color: "rgba(235, 245, 255, 0.92)",
                padding: "0 0.85rem",
              }}
            >
              <option value="classic">Classic</option>
              <option value="genshin">Genshin</option>
            </select>
          </label>
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

        <button
          className={`mio-nav-button mio-character-trigger ${isCharacterPickerOpen ? "is-open" : ""}`}
          type="button"
          aria-label={"\u89d2\u8272\u5207\u6362"}
          aria-haspopup="dialog"
          aria-expanded={isCharacterPickerOpen}
          onClick={() => {
            setIsCharacterPickerOpen((open) => !open);
            setIsMotionPickerOpen(false);
          }}
        >
          <img src={`${SPRITE}/asset-030.png`} alt="" />
        </button>

        <button
          className={`mio-nav-button mio-motion-trigger ${isMotionPickerOpen ? "is-open" : ""}`}
          type="button"
          data-testid="mio-motion-trigger"
          aria-label={"动作切换"}
          aria-haspopup="dialog"
          aria-expanded={isMotionPickerOpen}
          onClick={() => {
            setIsMotionPickerOpen((open) => !open);
            setIsCharacterPickerOpen(false);
          }}
        >
          <img src={`${SPRITE}/asset-006.png`} alt="" />
        </button>

        <button className="mio-nav-button is-bottom" type="button" aria-label={"\u8bbe\u7f6e"}>
          <img src={`${SPRITE}/asset-010.png`} alt="" />
        </button>

        {isCharacterPickerOpen ? (
          <section
            className="mio-character-panel"
            role="dialog"
            aria-label={"\u89d2\u8272\u5207\u6362\u9762\u677f"}
          >
            <header>
              <strong>{"\u89d2\u8272\u5207\u6362"}</strong>
              <span>{selectedModel ? getModelDisplayLabel(selectedModel) : "\u672a\u9009\u62e9\u89d2\u8272"}</span>
            </header>
            <div className="mio-character-list">
              {characterOptions.length === 0 ? (
                <p className="mio-character-empty">{"\u6682\u65e0\u53ef\u7528\u89d2\u8272"}</p>
              ) : (
                characterOptions.map((option) => (
                  <button
                    key={option.id}
                    className={`mio-character-option ${option.active ? "is-selected" : ""}`}
                    type="button"
                    data-testid="mio-character-option"
                    aria-label={`\u5207\u6362\u5230 ${option.label} \u89d2\u8272`}
                    onClick={() => handleCharacterSwitch(option.path)}
                  >
                    <span className="mio-character-avatar">
                      <img src={`${SPRITE}/asset-030.png`} alt="" />
                    </span>
                    <span className="mio-character-copy">
                      <strong>{option.label}</strong>
                      <small>{option.active ? "\u5f53\u524d\u4f7f\u7528\u4e2d" : "\u70b9\u51fb\u5207\u6362\u89d2\u8272"}</small>
                    </span>
                    <span className="mio-character-badge">{option.badge}</span>
                  </button>
                ))
              )}
            </div>
            <footer className="mio-character-panel-footer">
              <span>AVAILABLE MODELS</span>
              <strong>{characterOptions.length.toString().padStart(2, "0")}</strong>
            </footer>
          </section>
        ) : null}

        {isMotionPickerOpen ? (
          <section
            className="mio-motion-panel"
            data-testid="mio-motion-panel"
            role="dialog"
            aria-label={"动作切换面板"}
          >
            <header>
              <strong>{"动作切换"}</strong>
              <span>{activeMotionPath || "使用 MMD/vmd 内置动作"}</span>
            </header>
            <div className="mio-motion-list">
              {motions.length === 0 ? (
                <p className="mio-motion-empty">{"MMD/vmd 下暂无可用 .vmd 动作"}</p>
              ) : (
                motions.map((motion) => {
                  const active = motion.relative_path === activeMotionPath;
                  return (
                    <button
                      key={motion.relative_path}
                      className={`mio-motion-option ${active ? "is-selected" : ""}`}
                      type="button"
                      data-testid="mio-motion-option"
                      aria-label={`切换到 ${motion.label} 动作`}
                      onClick={() => previewBuiltInMotion(motion)}
                    >
                      <span className="mio-motion-chip">{active ? "ON" : "VMD"}</span>
                      <span className="mio-motion-copy">
                        <strong>{motion.label}</strong>
                        <small>{motion.relative_path}</small>
                      </span>
                    </button>
                  );
                })
              )}
            </div>
            <footer className="mio-motion-panel-footer">
              <span>BUILT-IN MOTIONS</span>
              <strong>{motions.length.toString().padStart(2, "0")}</strong>
            </footer>
          </section>
        ) : null}
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
          chrome="bare"
          interaction={interaction}
          speaking={speaking}
          onInteractionComplete={handleStageInteractionComplete}
          models={models}
          selectedModelPath={selectedModelPath}
          modelUrl={selectedModel?.url || ""}
          modelLabel={selectedModel ? getModelDisplayLabel(selectedModel) : ""}
          renderPipeline={renderPipeline}
          onModelChange={setSelectedModelPath}
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
      <form className="mio-command-bar" data-testid="mio-command-bar" onSubmit={onSubmit}>
        <label className="mio-tts">
          <img src={`${SPRITE}/asset-013.png`} alt="" />
          <span>TTS</span>
          <input type="checkbox" checked={ttsEnabled} onChange={(event) => setTtsEnabled(event.target.checked)} />
        </label>

        <button className="mio-mic" type="button" aria-label={"\u8bed\u97f3\u8f93\u5165"}>
          <img src={`${SPRITE}/asset-020.png`} alt="" />
        </button>

        <input
          className="mio-command-input"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={INPUT_LABEL}
          aria-label={INPUT_LABEL}
        />

        <button className="mio-send" type="submit" disabled={loading} aria-label={"\u53d1\u9001"}>
          <img src={`${SPRITE}/asset-019.png`} alt="" />
          <span>{loading ? "\u53d1\u9001\u4e2d" : "\u53d1\u9001"}</span>
        </button>

        <label className="mio-mode">
          <img src={`${SPRITE}/asset-080.png`} alt="" />
          <span>{"\u8bed\u97f3\u6a21\u5f0f"}</span>
          <select value={ttsMode} onChange={(event) => setTtsMode(event.target.value as "browser" | "server")}>
            <option value="browser">browser</option>
            <option value="server">server</option>
          </select>
        </label>

        <button className="mio-mode" type="button" onClick={() => assets[0] && previewVmdAsset(assets[0])}>
          <img src={`${SPRITE}/asset-010.png`} alt="" />
          <span>{"\u9ad8\u7ea7\u529f\u80fd"}</span>
        </button>

        {error ? <p className="mio-error">{error}</p> : null}
      </form>
    </main>
  );
}

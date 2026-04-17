"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { MappingEditor } from "@/features/mapping/MappingEditor";
import { createVmdPreviewInteraction } from "@/features/mapping/vmdPreview.js";
import { getModelDisplayLabel, pickInitialModelSelection } from "@/features/stage/modelCatalog.js";
import { MMDStage } from "@/features/stage/MMDStage";
import { clearSession, loadSession } from "@/lib/session";
import {
  getResolvedMappings,
  listMmdModels,
  listVmdAssets,
  postChat,
  requestServerTts,
} from "@/lib/api";
import { resolvePlaybackPlan } from "@/features/mapping/resolveAction.js";
import type { ChatMessage, MappingConfig, MmdModelAsset, UserSession, VmdAsset } from "@/lib/types";

function makeHistory(messages: ChatMessage[]) {
  return messages
    .filter((item) => item.role === "user" || item.role === "assistant")
    .slice(-16)
    .map((item) => ({ role: item.role, content: item.content }));
}

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
  sequence: InteractionStep[];
};

const DEFAULT_MODEL_RELATIVE_PATH = [
  "绾崇編瑗夸笣路琛嶅厜鍘熺毊",
  "GirlsFrontline NemesisGnosisDefault.pmx",
].join("/");

export default function CompanionPage() {
  const router = useRouter();
  const [session, setSession] = useState<UserSession | null>(null);
  const [sessionId] = useState(() => crypto.randomUUID());
  const [messages, setMessages] = useState<ChatMessage[]>([
    { role: "assistant", content: "你好，我已经准备好陪你聊天了。" },
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
  const [selectedModelPath, setSelectedModelPath] = useState("");
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [ttsMode, setTtsMode] = useState<"browser" | "server">("browser");
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    setSession(loadSession());
  }, []);

  useEffect(() => {
    if (!session) return;
    Promise.all([getResolvedMappings(session.userId), listVmdAssets(session.userId), listMmdModels()])
      .then(([mappingRows, assetRows, modelRows]) => {
        setMappings(mappingRows);
        setAssets(assetRows);
        setModels(modelRows);
        setSelectedModelPath((current) => {
          if (current && modelRows.some((item) => item.relative_path === current)) return current;
          const preferred =
            modelRows.find((item) => item.relative_path === DEFAULT_MODEL_RELATIVE_PATH) ||
            modelRows.find((item) => item.name === "GirlsFrontline NemesisGnosisDefault.pmx") ||
            pickInitialModelSelection(modelRows, DEFAULT_MODEL_RELATIVE_PATH);
          return preferred?.relative_path || "";
        });
      })
      .catch((err: Error) => {
        setError(err.message);
      });
  }, [session]);

  const assetIndex = useMemo(() => {
    const map: Record<string, VmdAsset> = {};
    for (const item of assets) map[item.asset_id] = item;
    return map;
  }, [assets]);

  const selectedModel = useMemo(() => {
    return (
      models.find((item) => item.relative_path === selectedModelPath) ||
      pickInitialModelSelection(models, DEFAULT_MODEL_RELATIVE_PATH)
    );
  }, [models, selectedModelPath]);

  function previewVmdAsset(asset: VmdAsset) {
    setInteraction(createVmdPreviewInteraction(asset));
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
    setInput("");
    setError("");
    setLoading(true);
    setMessages((prev) => [...prev, { role: "user", content: userText }]);
    const traceId = crypto.randomUUID();

    try {
      const response = await postChat(
        {
          user_id: session.userId,
          message: userText,
          session_id: sessionId,
          history: makeHistory(messages),
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
        setInteraction({
          emotion: response.emotion,
          action: response.action,
          mode: "vmd",
          vmdUrl: plan.url,
          sequence: [],
        });
      } else {
        setInteraction({
          emotion: response.emotion,
          action: plan.action,
          mode: "procedural",
          vmdUrl: "",
          sequence: plan.sequence || [],
        });
      }
      await speak(response.text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setMessages((prev) => [
        ...prev,
        { role: "system", content: "发送失败，请检查 API 服务状态和配置。" },
      ]);
      setInteraction({
        emotion: "caring",
        action: "comfort",
        mode: "procedural",
        vmdUrl: "",
        sequence: [],
      });
    } finally {
      setLoading(false);
    }
  }

  if (!session) {
    return (
      <main className="page-shell" style={{ display: "grid", placeItems: "center" }}>
        <section className="panel" style={{ width: "min(520px, 92vw)", padding: "1.2rem" }}>
          <h2 style={{ marginTop: 0 }}>未登录</h2>
          <p className="muted">请先返回登录页输入用户 ID。</p>
          <Link className="btn" href="/">
            去登录
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell companion-grid">
      <MMDStage
        interaction={interaction}
        speaking={speaking}
        models={models}
        selectedModelPath={selectedModelPath}
        modelUrl={selectedModel?.url || ""}
        modelLabel={selectedModel ? getModelDisplayLabel(selectedModel) : ""}
        onModelChange={setSelectedModelPath}
      />

      <section className="panel" style={{ display: "grid", gridTemplateRows: "auto 1fr auto auto auto", minHeight: 0 }}>
        <header style={{ padding: "0.9rem 1rem", borderBottom: "1px solid rgba(140, 209, 255, 0.16)" }}>
          <h2 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Companion Chat</h2>
          <p className="muted" style={{ margin: "0.35rem 0 0" }}>
            user_id: {session.userId}
          </p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.6rem", flexWrap: "wrap" }}>
            <Link className="btn secondary" href="/traces">
              Trace 页面
            </Link>
            <button
              className="btn secondary"
              type="button"
              onClick={() => {
                clearSession();
                router.push("/");
              }}
            >
              退出登录
            </button>
          </div>
        </header>

        <div style={{ overflowY: "auto", padding: "0.9rem", display: "grid", gap: "0.7rem" }}>
          {messages.map((item, index) => (
            <article
              key={`${item.role}-${index}`}
              style={{
                maxWidth: "88%",
                borderRadius: "0.8rem",
                padding: "0.66rem 0.78rem",
                lineHeight: 1.55,
                fontSize: "0.92rem",
                marginLeft: item.role === "user" ? "auto" : "0",
                marginRight: item.role === "assistant" ? "auto" : "0",
                background:
                  item.role === "user"
                    ? "linear-gradient(135deg,#18c3a6,#0f8d97)"
                    : item.role === "assistant"
                      ? "rgba(35, 62, 86, 0.88)"
                      : "rgba(255, 179, 102, 0.13)",
                border:
                  item.role === "assistant"
                    ? "1px solid rgba(140,209,255,0.15)"
                    : item.role === "system"
                      ? "1px dashed rgba(255,182,109,0.4)"
                      : "1px solid transparent",
              }}
            >
              <p style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{item.content}</p>
              {item.traceId ? (
                <small className="muted" style={{ display: "block", marginTop: "0.3rem" }}>
                  trace_id: {item.traceId}
                </small>
              ) : null}
            </article>
          ))}
        </div>

        <form
          onSubmit={onSubmit}
          style={{
            borderTop: "1px solid rgba(140, 209, 255, 0.16)",
            padding: "0.85rem",
            display: "grid",
            gap: "0.55rem",
          }}
        >
          <textarea
            className="textarea"
            rows={3}
            placeholder="输入消息..."
            value={input}
            onChange={(event) => setInput(event.target.value)}
          />
          <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "0.55rem" }}>
            <div style={{ display: "flex", gap: "0.55rem", alignItems: "center" }}>
              <label style={{ display: "flex", gap: "0.35rem", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={ttsEnabled}
                  onChange={(event) => setTtsEnabled(event.target.checked)}
                />
                TTS
              </label>
              <select
                className="select"
                value={ttsMode}
                onChange={(event) => setTtsMode(event.target.value as "browser" | "server")}
                style={{ maxWidth: "10rem" }}
              >
                <option value="browser">browser</option>
                <option value="server">server</option>
              </select>
            </div>
            <button className="btn" type="submit" disabled={loading}>
              {loading ? "发送中..." : "发送"}
            </button>
          </div>
          {error ? (
            <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.88rem" }}>
              {error}
            </p>
          ) : null}
        </form>

        <MappingEditor
          userId={session.userId}
          mappings={mappings}
          onMappingsChange={setMappings}
          assets={assets}
          onAssetsChange={setAssets}
          onPreviewAsset={previewVmdAsset}
        />
      </section>
    </main>
  );
}

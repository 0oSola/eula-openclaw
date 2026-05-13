"use client";

import { FormEvent, useMemo, useState } from "react";

import { getTraceEvents, getTraceMirrors } from "@/lib/api";
import type { TraceEvent, TraceMirror } from "@/lib/types";

type TraceGroup = {
  traceId: string;
  events: TraceEvent[];
  mirrors: TraceMirror[];
};

const stageLabels: Record<string, string> = {
  "message_service.ingress": "消息进入服务",
  "message_service.openclaw.request": "发送到 OpenClaw",
  "message_service.openclaw.response": "收到 OpenClaw 响应",
  "message_service.tts.submit": "请求 TTS",
  "message_service.tts.reference": "收到 TTS 引用",
  "message_service.tts.worker": "TTS 后台轮询",
  "message_service.egress": "消息返回前端",
};

function getStageLabel(stage: string) {
  return stageLabels[stage] || stage;
}

function getStatusTone(status: string) {
  if (status === "ok" || status === "completed" || status === "ready") return "#66d9a3";
  if (status === "error" || status === "failed") return "#ff8b8b";
  if (status === "pending" || status === "start") return "#ffd27d";
  return "#9fc5ff";
}

function formatEventTitle(event: TraceEvent) {
  const label = getStageLabel(event.stage);
  if (event.error_code) return `${label} · ${event.status} · ${event.error_code}`;
  return `${label} · ${event.status}`;
}

export function TraceViewer({ userId }: { userId: string }) {
  const [traceId, setTraceId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [mirrors, setMirrors] = useState<TraceMirror[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const traceGroups = useMemo<TraceGroup[]>(() => {
    const grouped = new Map<string, TraceGroup>();

    for (const event of events) {
      const current = grouped.get(event.trace_id) || { traceId: event.trace_id, events: [], mirrors: [] };
      current.events.push(event);
      grouped.set(event.trace_id, current);
    }

    for (const mirror of mirrors) {
      const current = grouped.get(mirror.trace_id) || { traceId: mirror.trace_id, events: [], mirrors: [] };
      current.mirrors.push(mirror);
      grouped.set(mirror.trace_id, current);
    }

    return [...grouped.values()]
      .map((group) => ({
        ...group,
        events: [...group.events].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)),
        mirrors: [...group.mirrors].sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at)),
      }))
      .sort((left, right) => {
        const leftTime = Date.parse(left.events.at(-1)?.created_at || left.mirrors.at(-1)?.created_at || "") || 0;
        const rightTime = Date.parse(right.events.at(-1)?.created_at || right.mirrors.at(-1)?.created_at || "") || 0;
        return rightTime - leftTime;
      });
  }, [events, mirrors]);

  async function search(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const [eventRows, mirrorRows] = await Promise.all([
        getTraceEvents(userId, { traceId: traceId || undefined, targetUserId: targetUserId || undefined }),
        getTraceMirrors(userId, { traceId: traceId || undefined, targetUserId: targetUserId || undefined }),
      ]);
      setEvents(eventRows);
      setMirrors(mirrorRows);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Trace query failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="panel" style={{ padding: "0.9rem", display: "grid", gap: "0.9rem" }}>
      <div style={{ display: "grid", gap: "0.3rem" }}>
        <h3 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>消息链路日志</h3>
        <p className="muted" style={{ margin: 0 }}>
          按 `trace_id` 查看单次消息从发送、OpenClaw、TTS 到返回前端的完整阶段。
        </p>
      </div>

      <form onSubmit={search} style={{ display: "grid", gridTemplateColumns: "1.2fr 1fr auto", gap: "0.5rem" }}>
        <input
          className="input"
          placeholder="trace_id（建议输入具体一次发送的 trace_id）"
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
        />
        <input
          className="input"
          placeholder="target user_id（管理员可查他人）"
          value={targetUserId}
          onChange={(event) => setTargetUserId(event.target.value)}
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "查询中..." : "查询"}
        </button>
      </form>

      {error ? <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.9rem" }}>{error}</p> : null}

      {traceGroups.length === 0 ? (
        <div
          style={{
            border: "1px solid rgba(140, 209, 255, 0.14)",
            borderRadius: "0.75rem",
            padding: "0.9rem",
            color: "rgba(255,255,255,0.72)",
          }}
        >
          暂无链路结果。
        </div>
      ) : null}

      <div style={{ display: "grid", gap: "0.9rem" }}>
        {traceGroups.map((group) => {
          const firstEvent = group.events[0];
          const lastEvent = group.events.at(-1);
          const hasError = group.events.some((item) => item.status === "error" || item.status === "failed");

          return (
            <article
              key={group.traceId}
              style={{
                border: `1px solid ${hasError ? "rgba(255, 126, 126, 0.22)" : "rgba(140, 209, 255, 0.16)"}`,
                borderRadius: "0.8rem",
                padding: "0.85rem",
                display: "grid",
                gap: "0.75rem",
              }}
            >
              <div style={{ display: "grid", gap: "0.35rem" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                  <strong style={{ overflowWrap: "anywhere" }}>{group.traceId}</strong>
                  <span
                    style={{
                      padding: "0.2rem 0.55rem",
                      borderRadius: "999px",
                      background: hasError ? "rgba(255, 126, 126, 0.14)" : "rgba(102, 217, 163, 0.12)",
                      color: hasError ? "#ff9d9d" : "#7ce0b2",
                      fontSize: "0.8rem",
                    }}
                  >
                    {hasError ? "存在错误" : "链路完成"}
                  </span>
                </div>
                <div className="muted" style={{ fontSize: "0.85rem" }}>
                  {firstEvent?.created_at || "--"} 到 {lastEvent?.created_at || "--"}
                </div>
              </div>

              <div style={{ display: "grid", gap: "0.55rem" }}>
                {group.events.map((item, index) => (
                  <div
                    key={`${group.traceId}-event-${index}`}
                    style={{
                      borderLeft: `3px solid ${getStatusTone(item.status)}`,
                      background: "rgba(255,255,255,0.02)",
                      padding: "0.55rem 0.7rem",
                      borderRadius: "0 0.55rem 0.55rem 0",
                      display: "grid",
                      gap: "0.3rem",
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem", alignItems: "center" }}>
                      <strong style={{ fontSize: "0.92rem" }}>{formatEventTitle(item)}</strong>
                      <span className="muted" style={{ fontSize: "0.8rem" }}>
                        {item.latency_ms != null ? `${item.latency_ms} ms` : item.created_at}
                      </span>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        whiteSpace: "pre-wrap",
                        overflowWrap: "anywhere",
                        fontSize: "0.82rem",
                        color: "rgba(255,255,255,0.82)",
                      }}
                    >
                      {JSON.stringify(item.payload, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>

              {group.mirrors.length > 0 ? (
                <div style={{ display: "grid", gap: "0.55rem" }}>
                  <strong>OpenClaw 解析镜像</strong>
                  {group.mirrors.map((item, index) => (
                    <div
                      key={`${group.traceId}-mirror-${index}`}
                      style={{
                        border: "1px solid rgba(255, 188, 122, 0.18)",
                        borderRadius: "0.65rem",
                        padding: "0.65rem",
                        display: "grid",
                        gap: "0.45rem",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", gap: "0.75rem" }}>
                        <strong>{item.endpoint_used}</strong>
                        <span style={{ color: getStatusTone(item.status), fontSize: "0.82rem" }}>{item.status}</span>
                      </div>
                      <div className="muted" style={{ fontSize: "0.82rem" }}>
                        {item.created_at}
                      </div>
                      <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: "0.82rem" }}>
                        {JSON.stringify(item.normalized, null, 2)}
                      </pre>
                    </div>
                  ))}
                </div>
              ) : null}
            </article>
          );
        })}
      </div>
    </section>
  );
}

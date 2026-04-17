"use client";

import { FormEvent, useState } from "react";

import { getTraceEvents, getTraceMirrors } from "@/lib/api";
import type { TraceEvent, TraceMirror } from "@/lib/types";

export function TraceViewer({ userId }: { userId: string }) {
  const [traceId, setTraceId] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [events, setEvents] = useState<TraceEvent[]>([]);
  const [mirrors, setMirrors] = useState<TraceMirror[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    <section className="panel" style={{ padding: "0.9rem", display: "grid", gap: "0.8rem" }}>
      <h3 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif" }}>Trace Explorer</h3>
      <form onSubmit={search} style={{ display: "grid", gridTemplateColumns: "1fr 1fr auto", gap: "0.5rem" }}>
        <input
          className="input"
          placeholder="trace_id (optional)"
          value={traceId}
          onChange={(event) => setTraceId(event.target.value)}
        />
        <input
          className="input"
          placeholder="target user_id (admin only)"
          value={targetUserId}
          onChange={(event) => setTargetUserId(event.target.value)}
        />
        <button className="btn" type="submit" disabled={loading}>
          {loading ? "查询中..." : "查询"}
        </button>
      </form>
      {error ? (
        <p style={{ margin: 0, color: "var(--danger)", fontSize: "0.9rem" }}>
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: "0.55rem" }}>
        <strong>Events ({events.length})</strong>
        <div style={{ maxHeight: "28vh", overflowY: "auto", display: "grid", gap: "0.4rem" }}>
          {events.map((item, index) => (
            <article
              key={`${item.trace_id}-${index}`}
              style={{
                border: "1px solid rgba(140, 209, 255, 0.15)",
                borderRadius: "0.6rem",
                padding: "0.5rem",
                fontSize: "0.85rem",
              }}
            >
              <div>
                <strong>{item.trace_id}</strong> [{item.stage}] {item.status}
              </div>
              <div className="muted">{item.created_at}</div>
              <pre style={{ margin: "0.3rem 0 0", whiteSpace: "pre-wrap" }}>
                {JSON.stringify(item.payload, null, 2)}
              </pre>
            </article>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gap: "0.55rem" }}>
        <strong>Mirrors ({mirrors.length})</strong>
        <div style={{ maxHeight: "28vh", overflowY: "auto", display: "grid", gap: "0.4rem" }}>
          {mirrors.map((item, index) => (
            <article
              key={`${item.trace_id}-m-${index}`}
              style={{
                border: "1px solid rgba(255, 188, 122, 0.18)",
                borderRadius: "0.6rem",
                padding: "0.5rem",
                fontSize: "0.85rem",
              }}
            >
              <div>
                <strong>{item.trace_id}</strong> via {item.endpoint_used} ({item.status})
              </div>
              <div className="muted">{item.created_at}</div>
              <pre style={{ margin: "0.3rem 0 0", whiteSpace: "pre-wrap" }}>
                {JSON.stringify(item.normalized, null, 2)}
              </pre>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

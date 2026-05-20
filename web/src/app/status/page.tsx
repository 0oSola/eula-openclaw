"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";

import { getRuntimeHealth } from "@/lib/api";
import { loadSession } from "@/lib/session";
import type { RuntimeHealthStatus, TraceEvent, UserSession } from "@/lib/types";

function formatTime(value?: string | null): string {
  if (!value) return "--";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatStatus(value: boolean): string {
  return value ? "on" : "off";
}

function statusColor(value: string): string {
  const normalized = value.toLowerCase();
  if (["connected", "subscribed", "ok", "ready", "on"].includes(normalized)) return "#45d8b9";
  if (["reconnecting", "pending", "running", "queued"].includes(normalized)) return "#ffb469";
  return "#ff7676";
}

function StatusPill({ value }: { value: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.45rem",
        border: "1px solid rgba(151, 210, 239, 0.28)",
        borderRadius: "999px",
        padding: "0.28rem 0.55rem",
        background: "rgba(5, 15, 23, 0.72)",
        fontSize: "0.82rem",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: statusColor(value),
          boxShadow: `0 0 12px ${statusColor(value)}`,
        }}
      />
      {value}
    </span>
  );
}

function Metric({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      style={{
        minWidth: 0,
        border: "1px solid rgba(151, 210, 239, 0.18)",
        borderRadius: 8,
        padding: "0.72rem",
        background: "rgba(5, 15, 23, 0.44)",
      }}
    >
      <div className="muted" style={{ fontSize: "0.78rem" }}>
        {label}
      </div>
      <div style={{ marginTop: "0.25rem", overflowWrap: "anywhere", fontWeight: 700 }}>
        {value ?? "--"}
      </div>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <section className="panel" style={{ padding: "1rem", minWidth: 0 }}>
      <h2 style={{ margin: "0 0 0.8rem", fontSize: "1.05rem", fontFamily: "Space Grotesk, sans-serif" }}>{title}</h2>
      {children}
    </section>
  );
}

function StatusGrid({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
        gap: "0.72rem",
      }}
    >
      {children}
    </div>
  );
}

function RecentError({ event }: { event: TraceEvent }) {
  return (
    <div
      style={{
        borderTop: "1px solid rgba(151, 210, 239, 0.16)",
        padding: "0.72rem 0",
        display: "grid",
        gap: "0.3rem",
      }}
    >
      <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", alignItems: "center" }}>
        <StatusPill value={event.error_code || event.status} />
        <strong style={{ overflowWrap: "anywhere" }}>{event.stage}</strong>
      </div>
      <div className="muted">{formatTime(event.created_at)}</div>
      <code style={{ color: "#c8eaf8", whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
        {JSON.stringify(event.payload || {}, null, 2)}
      </code>
    </div>
  );
}

export default function RuntimeHealthPage() {
  const [session, setSession] = useState<UserSession | null>(null);
  const [health, setHealth] = useState<RuntimeHealthStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setSession(loadSession());
  }, []);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;

    const refreshHealth = async () => {
      setLoading(true);
      setError("");
      try {
        const nextHealth = await getRuntimeHealth(session.userId);
        if (!cancelled) {
          setHealth(nextHealth);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Runtime health request failed.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void refreshHealth();
    const timer = window.setInterval(() => {
      void refreshHealth();
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session]);

  if (!session) {
    return (
      <main className="page-shell" style={{ display: "grid", placeItems: "center" }}>
        <section className="panel" style={{ width: "min(520px, 92vw)", padding: "1.2rem" }}>
          <h2 style={{ marginTop: 0 }}>Not signed in</h2>
          <p className="muted">Open the companion page first so the admin user id is available.</p>
          <Link className="btn" href="/">
            Go to login
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main className="page-shell" style={{ display: "grid", gap: "1rem" }}>
      <section
        className="panel"
        style={{
          padding: "0.95rem",
          display: "flex",
          gap: "0.8rem",
          flexWrap: "wrap",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ margin: 0, fontFamily: "Space Grotesk, sans-serif", fontSize: "1.35rem" }}>Runtime Health</h1>
          <p className="muted" style={{ margin: "0.32rem 0 0" }}>
            user_id: {session.userId} | auto refresh: 5s | generated: {formatTime(health?.generated_at)}
          </p>
        </div>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <button
            className="btn"
            type="button"
            disabled={loading}
            onClick={() => {
              if (!session) return;
              setLoading(true);
              setError("");
              void getRuntimeHealth(session.userId)
                .then(setHealth)
                .catch((err) => setError(err instanceof Error ? err.message : "Runtime health request failed."))
                .finally(() => setLoading(false));
            }}
          >
            {loading ? "Refreshing" : "Refresh"}
          </button>
          <Link className="btn secondary" href="/traces">
            Trace
          </Link>
          <Link className="btn secondary" href="/companion">
            Companion
          </Link>
        </div>
      </section>

      {error ? (
        <section className="panel" style={{ padding: "0.85rem", borderColor: "rgba(255, 118, 118, 0.42)" }}>
          <strong>Health request failed</strong>
          <p style={{ margin: "0.35rem 0 0", overflowWrap: "anywhere" }}>{error}</p>
        </section>
      ) : null}

      {!health ? (
        <section className="panel" style={{ padding: "1rem" }}>
          {loading ? "Loading runtime health..." : "No health snapshot loaded."}
        </section>
      ) : (
        <>
          <Section title="Message Bridge">
            <StatusGrid>
              <Metric label="WebSocket status" value={<StatusPill value={health.message_bridge.status.websocket_status} />} />
              <Metric label="Enabled" value={formatStatus(health.message_bridge.status.enabled)} />
              <Metric label="Reconnects" value={health.message_bridge.status.reconnect_attempts} />
              <Metric label="Last connected" value={formatTime(health.message_bridge.status.last_connected_at)} />
              <Metric label="Default binding" value={health.message_bridge.binding?.external_session_key} />
              <Metric label="Local session" value={health.message_bridge.local_session?.id} />
              <Metric label="Latest message" value={health.message_bridge.latest_message?.created_at} />
              <Metric label="Synced from" value={health.message_bridge.latest_message?.synced_from} />
            </StatusGrid>
            {health.message_bridge.latest_message ? (
              <p className="muted" style={{ margin: "0.8rem 0 0", overflowWrap: "anywhere" }}>
                Latest {health.message_bridge.latest_message.role}: {health.message_bridge.latest_message.content_preview}
              </p>
            ) : null}
            {health.message_bridge.warnings.length > 0 ? (
              <ul style={{ margin: "0.8rem 0 0", paddingLeft: "1.2rem" }}>
                {health.message_bridge.warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            ) : null}
          </Section>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "1rem" }}>
            <Section title="OpenClaw">
              <StatusGrid>
                <Metric label="Base URL" value={health.openclaw.base_url} />
                <Metric label="Agent" value={health.openclaw.agent_id || "default"} />
                <Metric label="Model" value={health.openclaw.model || "default"} />
                <Metric label="Message channel" value={health.openclaw.message_channel} />
                <Metric label="Stream mode" value={health.openclaw.stream_mode} />
                <Metric label="Token" value={health.openclaw.token_configured ? "configured" : "missing"} />
                <Metric label="Timeout seconds" value={health.openclaw.timeout_seconds} />
              </StatusGrid>
            </Section>

            <Section title="TTS">
              <StatusGrid>
                <Metric label="Enabled" value={formatStatus(health.tts.enabled)} />
                <Metric label="Base URL" value={health.tts.base_url} />
                <Metric label="Timeout seconds" value={health.tts.timeout_seconds} />
                <Metric label="Max poll attempts" value={health.tts.max_poll_attempts} />
                <Metric label="TTS refs" value={JSON.stringify(health.tts.message_tts_by_status)} />
                <Metric label="Jobs" value={JSON.stringify(health.tts.jobs_by_status)} />
              </StatusGrid>
            </Section>
          </div>

          <Section title="Storage">
            <StatusGrid>
              <Metric label="API PID" value={health.api.pid} />
              <Metric label="SQLite" value={health.api.sqlite_path} />
              <Metric label="NDJSON logs" value={health.api.ndjson_dir} />
              <Metric label="Sessions" value={health.database.session_count} />
              <Metric label="Messages" value={health.database.message_count} />
              <Metric label="Bridge messages" value={health.database.bridge_message_count} />
              <Metric label="Trace events" value={health.database.trace_event_count} />
            </StatusGrid>
          </Section>

          <Section title="Recent Errors">
            {health.recent_errors.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>
                No recent error trace events.
              </p>
            ) : (
              health.recent_errors.map((event) => <RecentError key={`${event.trace_id}-${event.stage}-${event.created_at}`} event={event} />)
            )}
          </Section>
        </>
      )}
    </main>
  );
}

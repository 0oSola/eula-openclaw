"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import {
  applyCodexSession,
  createCodexInteractiveSession,
  decideCodexApproval,
  discardCodexSession,
  getCodexDiff,
  runCodexChecks,
  type CodexDiff,
} from "@/lib/codexApi";
import { codexConsoleReducer, codexWebSocketUrl, createCodexConsoleState } from "@/lib/codexEvents.js";

type CodexConsoleProps = {
  userId: string;
  localChatSessionId: string;
};

type CodexTranscriptItem = {
  id: string;
  kind: string;
  turnId: string;
  text: string;
};

type CodexMode = "read_only" | "patch";

type PendingApproval = {
  id: string;
  title: string;
  actionType: string;
  detail: Record<string, unknown>;
};

export function CodexConsole({ userId, localChatSessionId }: CodexConsoleProps) {
  const [state, dispatch] = useReducer(codexConsoleReducer, undefined, createCodexConsoleState);
  const [mode, setMode] = useState<CodexMode>("read_only");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [diff, setDiff] = useState<CodexDiff | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef("");
  const sessionModeRef = useRef<CodexMode | "">("");

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  function currentSessionId() {
    return state.sessionId || sessionIdRef.current;
  }

  async function ensureSession(): Promise<WebSocket> {
    const existing = socketRef.current;
    if (existing && existing.readyState === WebSocket.OPEN && sessionModeRef.current === mode) return existing;
    if (existing) existing.close();
    if (!userId) throw new Error("Codex requires an active user session.");

    setBusy(true);
    setActionError("");
    try {
      const session = await createCodexInteractiveSession(userId, {
        local_chat_session_id: localChatSessionId || null,
        workspace_id: "mmd-companion",
        mode,
        sandbox: mode === "patch" ? "workspace-write" : "read-only",
      });
      sessionIdRef.current = session.id;
      sessionModeRef.current = mode;
      setDiff(null);
      const socket = new WebSocket(codexWebSocketUrl(session.ws_url));
      socketRef.current = socket;
      socket.onmessage = (message) => {
        try {
          dispatch(JSON.parse(message.data));
        } catch {
          dispatch({ type: "turn_failed", error: "Codex event parse failed." });
        }
      };
      socket.onclose = () => {
        socketRef.current = null;
      };
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(new Error("Codex websocket connection failed."));
      });
      return socket;
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage() {
    const text = draft.trim();
    if (!text || busy) return;
    try {
      const socket = await ensureSession();
      socket.send(JSON.stringify({ type: "user_message", text, mode }));
      setDraft("");
    } catch (error) {
      dispatch({ type: "turn_failed", error: error instanceof Error ? error.message : "Codex send failed." });
    }
  }

  function cancelTurn() {
    socketRef.current?.send(JSON.stringify({ type: "cancel_turn" }));
  }

  async function loadDiff() {
    const sessionId = currentSessionId();
    if (!sessionId) return;
    setActionBusy("diff");
    setActionError("");
    try {
      const nextDiff = await getCodexDiff(userId, sessionId);
      setDiff(nextDiff);
      dispatch({
        type: "diff_ready",
        artifact_id: nextDiff.artifact_id,
        changed_files: nextDiff.changed_files,
      });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Codex diff failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function runChecks() {
    const sessionId = currentSessionId();
    if (!sessionId) return;
    setActionBusy("checks");
    setActionError("");
    try {
      const result = await runCodexChecks(userId, sessionId, ["api"]);
      dispatch({ type: "checks_completed", artifact_id: result.artifact_id, results: result.results });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Codex checks failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function decideApproval(approvalId: string, decision: "approve_once" | "deny") {
    const sessionId = currentSessionId();
    if (!sessionId) return;
    setActionBusy(`${decision}:${approvalId}`);
    setActionError("");
    try {
      await decideCodexApproval(userId, sessionId, approvalId, decision);
      dispatch({ type: "approval_decided", approval_id: approvalId, decision });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Codex approval update failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function applySession() {
    const sessionId = currentSessionId();
    if (!sessionId) return;
    if (!window.confirm("Apply Codex patch to the main workspace?")) return;
    setActionBusy("apply");
    setActionError("");
    try {
      const result = await applyCodexSession(userId, sessionId, true);
      dispatch({ type: "apply_completed", artifact_id: result.artifact_id, changed_files: result.changed_files });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Codex apply failed.");
    } finally {
      setActionBusy("");
    }
  }

  async function discardSession() {
    const sessionId = currentSessionId();
    if (!sessionId) return;
    setActionBusy("discard");
    setActionError("");
    try {
      await discardCodexSession(userId, sessionId);
      socketRef.current?.close();
      socketRef.current = null;
      sessionIdRef.current = "";
      sessionModeRef.current = "";
      setDiff(null);
      dispatch({ type: "session_closed", reason: "discarded" });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Codex discard failed.");
    } finally {
      setActionBusy("");
    }
  }

  const sessionId = currentSessionId();
  const pendingApprovals = (state.pendingApprovals || []) as PendingApproval[];
  const changedFiles = (state.changedFiles || []) as string[];

  return (
    <article className="mio-card mio-workspace-card">
      <h2>
        Codex <small>TASKS</small>
      </h2>
      <div className="mio-card-copy">
        <p>
          {sessionId || "未连接"} · {state.status} · {mode === "patch" ? "patch" : "read-only"}
        </p>
        {state.error ? <p>{state.error}</p> : null}
        {actionError ? <p>{actionError}</p> : null}
        {changedFiles.length ? <p>{changedFiles.length} changed file(s)</p> : null}
      </div>
      <div className="mio-chatbox-session-actions" aria-label="Codex session actions">
        <select
          aria-label="Codex mode"
          value={mode}
          disabled={Boolean(sessionId) || busy}
          onChange={(event) => setMode(event.target.value as CodexMode)}
        >
          <option value="read_only">Read-only</option>
          <option value="patch">Patch</option>
        </select>
        <button type="button" onClick={() => void loadDiff()} disabled={!sessionId || actionBusy === "diff"}>
          Diff
        </button>
        <button type="button" onClick={() => void runChecks()} disabled={!sessionId || actionBusy === "checks"}>
          Checks
        </button>
        <button type="button" onClick={() => void applySession()} disabled={!sessionId || mode !== "patch" || actionBusy === "apply"}>
          Apply
        </button>
        <button type="button" onClick={() => void discardSession()} disabled={!sessionId || actionBusy === "discard"}>
          Discard
        </button>
      </div>
      {pendingApprovals.length ? (
        <div className="mio-card-copy">
          {pendingApprovals.map((approval) => (
            <article key={approval.id} className="mio-chatbox-message is-system">
              <div className="mio-chatbox-message-head">
                <strong>{approval.title}</strong>
                <span>{approval.actionType}</span>
              </div>
              <div className="mio-chatbox-message-body">{JSON.stringify(approval.detail)}</div>
              <div className="mio-chatbox-session-actions">
                <button
                  type="button"
                  onClick={() => void decideApproval(approval.id, "approve_once")}
                  disabled={Boolean(actionBusy)}
                >
                  Approve
                </button>
                <button type="button" onClick={() => void decideApproval(approval.id, "deny")} disabled={Boolean(actionBusy)}>
                  Deny
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : null}
      <div className="mio-chatbox-list" aria-label="Codex transcript">
        {state.transcript.length ? (
          <div className="mio-chatbox-message-flow">
            {state.transcript.map((item: CodexTranscriptItem) => (
              <article key={item.id} className={`mio-chatbox-message is-${item.kind === "error" ? "system" : "assistant"}`}>
                <div className="mio-chatbox-message-head">
                  <strong>{item.kind}</strong>
                  <span>{item.turnId ? item.turnId.slice(0, 12) : "session"}</span>
                </div>
                <div className="mio-chatbox-message-body">{item.text}</div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mio-chatbox-empty">
            <strong>Codex Console</strong>
            <span>Read-only session</span>
          </div>
        )}
      </div>
      {diff?.patch ? (
        <pre className="mio-advanced-json-preview" aria-label="Codex diff preview">
          {diff.patch}
        </pre>
      ) : null}
      <footer className="mio-chatbox-footer">
        <textarea
          value={draft}
          rows={3}
          placeholder="Ask Codex to inspect the local repo"
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="button" onClick={() => void sendMessage()} disabled={!draft.trim() || busy}>
          Send
        </button>
        <button type="button" onClick={cancelTurn} disabled={state.status !== "running_turn"}>
          Cancel
        </button>
      </footer>
    </article>
  );
}

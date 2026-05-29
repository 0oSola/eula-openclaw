"use client";

import { useEffect, useReducer, useRef, useState } from "react";

import { createCodexInteractiveSession } from "@/lib/codexApi";
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

export function CodexConsole({ userId, localChatSessionId }: CodexConsoleProps) {
  const [state, dispatch] = useReducer(codexConsoleReducer, undefined, createCodexConsoleState);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef("");

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  async function ensureSession(): Promise<WebSocket> {
    const existing = socketRef.current;
    if (existing && existing.readyState === WebSocket.OPEN) return existing;
    if (!userId) throw new Error("Codex requires an active user session.");

    setBusy(true);
    try {
      const session = await createCodexInteractiveSession(userId, {
        local_chat_session_id: localChatSessionId || null,
        workspace_id: "mmd-companion",
        mode: "read_only",
        sandbox: "read-only",
      });
      sessionIdRef.current = session.id;
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
      socket.send(JSON.stringify({ type: "user_message", text, mode: "read_only" }));
      setDraft("");
    } catch (error) {
      dispatch({ type: "turn_failed", error: error instanceof Error ? error.message : "Codex send failed." });
    }
  }

  function cancelTurn() {
    socketRef.current?.send(JSON.stringify({ type: "cancel_turn" }));
  }

  return (
    <article className="mio-card mio-workspace-card">
      <h2>
        Codex <small>TASKS</small>
      </h2>
      <div className="mio-card-copy">
        <p>
          {sessionIdRef.current || state.sessionId || "未连接"} · {state.status}
        </p>
        {state.error ? <p>{state.error}</p> : null}
      </div>
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

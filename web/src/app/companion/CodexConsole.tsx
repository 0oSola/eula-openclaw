"use client";

import { useEffect, useReducer, useRef, useState, type KeyboardEvent } from "react";

import {
  applyCodexSession,
  createCodexInteractiveSession,
  createCodexWorkspace,
  decideCodexApproval,
  discardCodexSession,
  getCodexDiff,
  listCodexWorkspaces,
  pickCodexWorkspacePath,
  runCodexChecks,
  type CodexDiff,
  type CodexWorkspace,
} from "@/lib/codexApi";
import { codexConsoleReducer, codexWebSocketUrl, createCodexConsoleState } from "@/lib/codexEvents.js";
import { shouldSendCodexPromptOnKeyDown } from "@/lib/codexInput.js";
import { CodexTerminalPane } from "./CodexTerminalPane";

type CodexConsoleProps = {
  userId: string;
  localChatSessionId: string;
  onWorkspaceChange?: (workspaceId: string) => void;
};

type CodexMode = "read_only" | "patch";

type PendingApproval = {
  id: string;
  title: string;
  actionType: string;
  detail: Record<string, unknown>;
};

function mergeWorkspace(items: CodexWorkspace[], workspace: CodexWorkspace) {
  const next = items.filter((item) => item.id !== workspace.id);
  next.push(workspace);
  return next;
}

function workspaceIdFromPath(path: string) {
  const name = path.split(/[\\/]+/).filter(Boolean).pop() || "";
  const slug = name.replace(/[^A-Za-z0-9_.-]+/g, "-").replace(/^-+|-+$/g, "");
  return slug || "codex-workspace";
}

export function CodexConsole({ userId, localChatSessionId, onWorkspaceChange }: CodexConsoleProps) {
  const [state, dispatch] = useReducer(codexConsoleReducer, undefined, createCodexConsoleState);
  const [mode, setMode] = useState<CodexMode>("read_only");
  const [workspaces, setWorkspaces] = useState<CodexWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState("mmd-companion");
  const [workspaceIdDraft, setWorkspaceIdDraft] = useState("");
  const [workspacePathDraft, setWorkspacePathDraft] = useState("");
  const [workspaceBusy, setWorkspaceBusy] = useState(false);
  const [workspaceError, setWorkspaceError] = useState("");
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [actionError, setActionError] = useState("");
  const [diff, setDiff] = useState<CodexDiff | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionIdRef = useRef("");
  const sessionModeRef = useRef<CodexMode | "">("");
  const sessionWorkspaceRef = useRef("");

  useEffect(() => {
    return () => {
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    onWorkspaceChange?.(workspaceId);
  }, [onWorkspaceChange, workspaceId]);

  useEffect(() => {
    if (!userId) return;
    let active = true;
    setWorkspaceError("");
    void listCodexWorkspaces(userId)
      .then((result) => {
        if (!active) return;
        const nextWorkspaces = result.workspaces || [];
        setWorkspaces(nextWorkspaces);
        setWorkspaceId((current) => {
          if (nextWorkspaces.some((workspace) => workspace.id === current)) return current;
          return nextWorkspaces[0]?.id || current || "mmd-companion";
        });
      })
      .catch((error) => {
        if (!active) return;
        setWorkspaceError(error instanceof Error ? error.message : "Codex workspace load failed.");
      });
    return () => {
      active = false;
    };
  }, [userId]);

  function currentSessionId() {
    return state.sessionId || sessionIdRef.current;
  }

  async function ensureSession(): Promise<WebSocket> {
    const existing = socketRef.current;
    const selectedWorkspaceId = workspaceId.trim();
    if (
      existing &&
      existing.readyState === WebSocket.OPEN &&
      sessionModeRef.current === mode &&
      sessionWorkspaceRef.current === selectedWorkspaceId
    ) {
      return existing;
    }
    if (existing) existing.close();
    if (!userId) throw new Error("Codex requires an active user session.");
    if (!selectedWorkspaceId) throw new Error("Select a Codex workspace first.");

    setBusy(true);
    setActionError("");
    try {
      const session = await createCodexInteractiveSession(userId, {
        local_chat_session_id: localChatSessionId || null,
        workspace_id: workspaceId,
        mode,
        sandbox: mode === "patch" ? "workspace-write" : "read-only",
      });
      sessionIdRef.current = session.id;
      sessionModeRef.current = mode;
      sessionWorkspaceRef.current = session.workspace_id;
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

  async function createWorkspace() {
    const nextId = workspaceIdDraft.trim();
    const nextPath = workspacePathDraft.trim();
    if (currentSessionId()) {
      setWorkspaceError("Close the current Codex session before changing workspace.");
      return;
    }
    if (!nextId || !nextPath) {
      setWorkspaceError("Workspace id and path are required.");
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const result = await createCodexWorkspace(userId, {
        workspace_id: nextId,
        path: nextPath,
      });
      setWorkspaces((current) => mergeWorkspace(current, result.workspace));
      setWorkspaceId(result.workspace.id);
      setWorkspaceIdDraft("");
      setWorkspacePathDraft("");
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Codex workspace create failed.");
    } finally {
      setWorkspaceBusy(false);
    }
  }

  async function browseWorkspacePath() {
    if (currentSessionId()) {
      setWorkspaceError("Close the current Codex session before changing workspace.");
      return;
    }
    setWorkspaceBusy(true);
    setWorkspaceError("");
    try {
      const result = await pickCodexWorkspacePath(userId, {
        initial_path: workspacePathDraft.trim() || selectedWorkspace?.path || null,
      });
      if (result.path) {
        setWorkspacePathDraft(result.path);
        setWorkspaceIdDraft((current) => current.trim() || workspaceIdFromPath(result.path || ""));
      }
    } catch (error) {
      setWorkspaceError(error instanceof Error ? error.message : "Codex workspace path picker failed.");
    } finally {
      setWorkspaceBusy(false);
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

  function handleDraftKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (!shouldSendCodexPromptOnKeyDown(event)) return;
    event.preventDefault();
    void sendMessage();
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
      sessionWorkspaceRef.current = "";
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
  const selectedWorkspace = workspaces.find((workspace) => workspace.id === workspaceId);

  return (
    <article className="mio-card mio-workspace-card">
      <h2>
        Codex <small>TASKS</small>
      </h2>
      <div className="mio-card-copy">
        <p>
          {sessionId || "未连接"} · {state.status} · {workspaceId} · {mode === "patch" ? "patch" : "read-only"}
        </p>
        {state.error ? <p>{state.error}</p> : null}
        {workspaceError ? <p>{workspaceError}</p> : null}
        {actionError ? <p>{actionError}</p> : null}
        {changedFiles.length ? <p>{changedFiles.length} changed file(s)</p> : null}
      </div>
      <div className="mio-chatbox-session-actions" aria-label="Codex session actions">
        <select
          aria-label="Codex workspace"
          value={workspaceId}
          disabled={Boolean(sessionId) || busy || workspaceBusy}
          onChange={(event) => setWorkspaceId(event.target.value)}
        >
          {workspaces.length ? (
            workspaces.map((workspace) => (
              <option key={workspace.id} value={workspace.id}>
                {workspace.id}
              </option>
            ))
          ) : (
            <option value={workspaceId}>{workspaceId}</option>
          )}
        </select>
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
      <div className="codex-workspace-create" aria-label="Create Codex workspace">
        <span className="codex-workspace-path" title={selectedWorkspace?.path || ""}>
          {selectedWorkspace ? `${selectedWorkspace.source}:${selectedWorkspace.path}` : "workspace:unregistered"}
        </span>
        <input
          aria-label="New Codex workspace id"
          value={workspaceIdDraft}
          placeholder="workspace-id"
          disabled={Boolean(sessionId) || workspaceBusy}
          onChange={(event) => setWorkspaceIdDraft(event.target.value)}
        />
        <input
          aria-label="New Codex workspace path"
          value={workspacePathDraft}
          placeholder="D:\\path\\repo"
          disabled={Boolean(sessionId) || workspaceBusy}
          onChange={(event) => setWorkspacePathDraft(event.target.value)}
        />
        <button
          type="button"
          aria-label="Browse Codex workspace path"
          onClick={() => void browseWorkspacePath()}
          disabled={Boolean(sessionId) || workspaceBusy}
        >
          Browse
        </button>
        <button
          type="button"
          onClick={() => void createWorkspace()}
          disabled={Boolean(sessionId) || workspaceBusy || !workspaceIdDraft.trim() || !workspacePathDraft.trim()}
        >
          Mount
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
      <CodexTerminalPane transcript={state.transcript} status={state.status} workspaceId={workspaceId} mode={mode} />
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
          onKeyDown={handleDraftKeyDown}
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

const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function resolveBaseUrl(baseUrl = DEFAULT_API_BASE_URL) {
  const url = new URL(baseUrl);
  if (typeof window !== "undefined") {
    const runtimeHostname = window.location.hostname;
    if (
      runtimeHostname &&
      runtimeHostname !== "localhost" &&
      runtimeHostname !== "127.0.0.1" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    ) {
      url.hostname = runtimeHostname;
    }
  }
  return url;
}

export function codexWebSocketUrl(path, { baseUrl = DEFAULT_API_BASE_URL } = {}) {
  const base = resolveBaseUrl(baseUrl);
  base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
  const source = new URL(path, base);
  const normalizedPath = source.pathname.replace(/^\/api\/backend/, "") || "/";
  base.pathname = normalizedPath;
  base.search = new URLSearchParams(source.searchParams).toString();
  base.hash = "";
  return base.toString();
}

export function createCodexConsoleState() {
  return {
    status: "idle",
    sessionId: "",
    threadId: "",
    activeTurnId: "",
    mode: "read_only",
    changedFiles: [],
    diffArtifactId: "",
    pendingApprovals: [],
    checks: [],
    applied: false,
    transcript: [],
    error: "",
  };
}

function appendOrMergeAssistant(transcript, turnId, text) {
  const id = `${turnId}:assistant`;
  const existingIndex = transcript.findIndex((item) => item.id === id);
  if (existingIndex < 0) {
    return [...transcript, { id, kind: "assistant", turnId, text }];
  }
  return transcript.map((item, index) => (index === existingIndex ? { ...item, text: `${item.text}${text}` } : item));
}

function transcriptItem(id, kind, turnId, text) {
  return { id, kind, turnId: turnId || "", text: text || "" };
}

export function codexConsoleReducer(state, event) {
  switch (event?.type) {
    case "session_ready":
      return {
        ...state,
        status: "ready",
        sessionId: event.session_id || state.sessionId,
        threadId: event.thread_id || "",
        error: "",
      };
    case "turn_started":
      return {
        ...state,
        status: "running_turn",
        activeTurnId: event.turn_id || "",
        mode: event.mode || state.mode,
        error: "",
      };
    case "text_delta":
    case "plan_delta":
      return {
        ...state,
        transcript: appendOrMergeAssistant(state.transcript, event.turn_id || state.activeTurnId, event.text || ""),
      };
    case "command_started":
      return {
        ...state,
        transcript: [
          ...state.transcript,
          transcriptItem(
            `${event.turn_id || state.activeTurnId}:command:${state.transcript.length}`,
            "command",
            event.turn_id || state.activeTurnId,
            event.command || "",
          ),
        ],
      };
    case "command_output":
      return {
        ...state,
        transcript: [
          ...state.transcript,
          transcriptItem(
            `${event.turn_id || state.activeTurnId}:output:${state.transcript.length}`,
            "output",
            event.turn_id || state.activeTurnId,
            `${event.stream || "stdout"}: ${event.text || ""}`,
          ),
        ],
      };
    case "approval_required":
      return {
        ...state,
        status: "waiting_approval",
        pendingApprovals: [
          ...state.pendingApprovals,
          {
            id: event.approval_id || "",
            turnId: event.turn_id || state.activeTurnId,
            actionType: event.action_type || "",
            title: event.title || "Approval required",
            detail: event.detail || {},
          },
        ],
        transcript: [
          ...state.transcript,
          transcriptItem(
            `${event.approval_id}:approval`,
            "approval",
            event.turn_id || state.activeTurnId,
            event.title || "Approval required",
          ),
        ],
      };
    case "approval_decided":
      return {
        ...state,
        status: state.pendingApprovals.length <= 1 ? "ready" : state.status,
        pendingApprovals: state.pendingApprovals.filter((approval) => approval.id !== event.approval_id),
        transcript: [
          ...state.transcript,
          transcriptItem(
            `${event.approval_id}:decision`,
            "approval_decision",
            "",
            event.decision || "",
          ),
        ],
      };
    case "diff_ready":
      return {
        ...state,
        diffArtifactId: event.artifact_id || "",
        changedFiles: Array.isArray(event.changed_files) ? event.changed_files : [],
        transcript: [
          ...state.transcript,
          transcriptItem(
            `${event.artifact_id || "diff"}:diff`,
            "diff",
            event.turn_id || state.activeTurnId,
            Array.isArray(event.changed_files) ? event.changed_files.join("\n") : "",
          ),
        ],
      };
    case "checks_completed":
      return {
        ...state,
        checks: Array.isArray(event.results) ? event.results : [],
        transcript: [
          ...state.transcript,
          transcriptItem(
            `${event.artifact_id || "checks"}:checks`,
            "checks",
            "",
            `${Array.isArray(event.results) ? event.results.length : 0} check command(s) completed`,
          ),
        ],
      };
    case "apply_completed":
      return {
        ...state,
        applied: true,
        changedFiles: Array.isArray(event.changed_files) ? event.changed_files : state.changedFiles,
        transcript: [
          ...state.transcript,
          transcriptItem(
            `${event.artifact_id || "apply"}:apply`,
            "apply",
            "",
            Array.isArray(event.changed_files) ? event.changed_files.join("\n") : "Applied",
          ),
        ],
      };
    case "turn_completed":
      return {
        ...state,
        status: "completed_turn",
        activeTurnId: "",
        transcript: [
          ...state.transcript,
          {
            id: `${event.turn_id || state.activeTurnId}:final`,
            kind: "final",
            turnId: event.turn_id || state.activeTurnId,
            text: event.final_text || "",
          },
        ],
      };
    case "turn_failed":
      return {
        ...state,
        status: "failed_turn",
        activeTurnId: "",
        error: event.error || "Codex turn failed.",
        transcript: [
          ...state.transcript,
          {
            id: `${event.turn_id || state.activeTurnId || "session"}:error`,
            kind: "error",
            turnId: event.turn_id || state.activeTurnId || "",
            text: event.error || "Codex turn failed.",
          },
        ],
      };
    case "session_closed":
      return {
        ...state,
        status: "closed",
        sessionId: "",
        threadId: "",
        activeTurnId: "",
        pendingApprovals: [],
      };
    default:
      return state;
  }
}

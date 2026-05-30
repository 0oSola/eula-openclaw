import test from "node:test";
import assert from "node:assert/strict";

import {
  codexConsoleReducer,
  codexWebSocketUrl,
  createCodexConsoleState,
} from "../src/lib/codexEvents.js";

test("codexWebSocketUrl resolves backend websocket URL", () => {
  assert.equal(
    codexWebSocketUrl("/api/backend/ws/codex/interactive/codex_sess_1?user_id=admin-1", {
      baseUrl: "http://127.0.0.1:8000",
    }),
    "ws://127.0.0.1:8000/ws/codex/interactive/codex_sess_1?user_id=admin-1",
  );
  assert.equal(
    codexWebSocketUrl("/ws/codex/interactive/s 1?user_id=admin 1", { baseUrl: "https://api.test" }),
    "wss://api.test/ws/codex/interactive/s%201?user_id=admin+1",
  );
});

test("codexConsoleReducer appends streaming transcript and completion", () => {
  let state = createCodexConsoleState();
  state = codexConsoleReducer(state, { type: "session_ready", session_id: "codex_sess_1", thread_id: "thread-1" });
  state = codexConsoleReducer(state, { type: "turn_started", turn_id: "turn-1" });
  state = codexConsoleReducer(state, { type: "text_delta", turn_id: "turn-1", text: "hello " });
  state = codexConsoleReducer(state, { type: "text_delta", turn_id: "turn-1", text: "world" });
  state = codexConsoleReducer(state, { type: "turn_completed", turn_id: "turn-1", final_text: "done" });

  assert.equal(state.status, "completed_turn");
  assert.equal(state.sessionId, "codex_sess_1");
  assert.equal(state.threadId, "thread-1");
  assert.deepEqual(state.transcript, [
    { id: "turn-1:assistant", kind: "assistant", turnId: "turn-1", text: "hello world" },
    { id: "turn-1:final", kind: "final", turnId: "turn-1", text: "done" },
  ]);
});

test("codexConsoleReducer records cancellation failures", () => {
  let state = createCodexConsoleState();
  state = codexConsoleReducer(state, { type: "turn_started", turn_id: "turn-2" });
  state = codexConsoleReducer(state, { type: "turn_failed", turn_id: "turn-2", error: "Turn cancelled." });

  assert.equal(state.status, "failed_turn");
  assert.equal(state.error, "Turn cancelled.");
  assert.deepEqual(state.transcript, [
    { id: "turn-2:error", kind: "error", turnId: "turn-2", text: "Turn cancelled." },
  ]);
});

test("codexConsoleReducer records diff and command output events", () => {
  let state = createCodexConsoleState();
  state = codexConsoleReducer(state, { type: "turn_started", turn_id: "turn-3" });
  state = codexConsoleReducer(state, {
    type: "command_output",
    turn_id: "turn-3",
    stream: "stdout",
    text: "pytest passed",
  });
  state = codexConsoleReducer(state, {
    type: "diff_ready",
    turn_id: "turn-3",
    artifact_id: "artifact-diff",
    changed_files: ["api/app/example.py"],
  });

  assert.equal(state.diffArtifactId, "artifact-diff");
  assert.deepEqual(state.changedFiles, ["api/app/example.py"]);
  assert.deepEqual(state.transcript, [
    { id: "turn-3:output:0", kind: "output", turnId: "turn-3", text: "stdout: pytest passed" },
    { id: "artifact-diff:diff", kind: "diff", turnId: "turn-3", text: "api/app/example.py" },
  ]);
});

test("codexConsoleReducer tracks approval metadata and decisions", () => {
  let state = createCodexConsoleState();
  state = codexConsoleReducer(state, {
    type: "approval_required",
    turn_id: "turn-4",
    approval_id: "approval-1",
    action_type: "command",
    title: "Run command",
    detail: { command: "npm test" },
  });

  assert.equal(state.status, "waiting_approval");
  assert.deepEqual(state.pendingApprovals, [
    {
      id: "approval-1",
      turnId: "turn-4",
      actionType: "command",
      title: "Run command",
      detail: { command: "npm test" },
    },
  ]);

  state = codexConsoleReducer(state, {
    type: "approval_decided",
    approval_id: "approval-1",
    decision: "deny",
  });

  assert.equal(state.status, "ready");
  assert.deepEqual(state.pendingApprovals, []);
  assert.equal(state.transcript.at(-1).text, "deny");
});

test("codexConsoleReducer records checks and apply completion", () => {
  let state = createCodexConsoleState();
  state = codexConsoleReducer(state, {
    type: "checks_completed",
    artifact_id: "artifact-checks",
    results: [{ check: "api", exit_code: 0 }],
  });
  state = codexConsoleReducer(state, {
    type: "apply_completed",
    artifact_id: "artifact-apply",
    changed_files: ["README.md"],
  });

  assert.deepEqual(state.checks, [{ check: "api", exit_code: 0 }]);
  assert.equal(state.applied, true);
  assert.deepEqual(state.changedFiles, ["README.md"]);
  assert.equal(state.transcript.at(-2).kind, "checks");
  assert.equal(state.transcript.at(-1).kind, "apply");
});

test("codexConsoleReducer clears active session on close", () => {
  let state = createCodexConsoleState();
  state = codexConsoleReducer(state, { type: "session_ready", session_id: "codex_sess_1", thread_id: "thread-1" });
  state = codexConsoleReducer(state, {
    type: "approval_required",
    turn_id: "turn-5",
    approval_id: "approval-5",
    action_type: "command",
    title: "Run command",
  });
  state = codexConsoleReducer(state, { type: "session_closed", reason: "discarded" });

  assert.equal(state.status, "closed");
  assert.equal(state.sessionId, "");
  assert.equal(state.threadId, "");
  assert.deepEqual(state.pendingApprovals, []);
});

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

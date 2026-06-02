import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  codexConsoleReducer,
  codexWebSocketUrl,
  createCodexConsoleState,
} from "../src/lib/codexEvents.js";
import { shouldSendCodexPromptOnKeyDown } from "../src/lib/codexInput.js";
import { formatCodexTerminalTranscript } from "../src/lib/codexTerminalLines.js";
import { resolveCompanionNavTarget } from "../src/lib/companionNavigation.js";

test("companion tasks navigation opens a dedicated page", () => {
  assert.deepEqual(resolveCompanionNavTarget("tasks"), { kind: "page", href: "/companion/tasks" });
  assert.deepEqual(resolveCompanionNavTarget("chat"), { kind: "panel", view: "chat" });
});

test("companion tasks page hosts the Codex console", () => {
  const pageUrl = new URL("../src/app/companion/tasks/page.tsx", import.meta.url);
  assert.equal(existsSync(pageUrl), true);
  const source = readFileSync(pageUrl, "utf8");
  assert.match(source, /<CodexConsole/);
  assert.match(source, /loadSession\(\)/);
});

test("companion tasks page uses a tmux style terminal shell", () => {
  const pageUrl = new URL("../src/app/companion/tasks/page.tsx", import.meta.url);
  const cssUrl = new URL("../src/app/globals.css", import.meta.url);
  const source = readFileSync(pageUrl, "utf8");
  const css = readFileSync(cssUrl, "utf8");

  assert.match(source, /codex-tmux-shell/);
  assert.match(source, /codex-tmux-status/);
  assert.match(source, /codex-tmux-pane/);
  assert.match(css, /\.codex-tmux-shell/);
  assert.match(css, /JetBrains Mono/);
});

test("codex terminal formatter renders transcript events as terminal lines", () => {
  const lines = formatCodexTerminalTranscript(
    [
      { id: "turn-1:assistant", kind: "assistant", turnId: "turn-1", text: "hello" },
      { id: "turn-1:command:1", kind: "command", turnId: "turn-1", text: "npm test" },
      { id: "turn-1:output:2", kind: "output", turnId: "turn-1", text: "stdout: passed" },
      { id: "turn-1:error", kind: "error", turnId: "turn-1", text: "failed" },
    ],
    { status: "running_turn", workspaceId: "mmd-companion", mode: "read_only" },
  );

  assert.deepEqual(
    lines.map((line) => line.prompt),
    ["codex", "$", ">", "error"],
  );
  assert.equal(lines[0].text, "hello");
  assert.equal(lines.at(-1).tone, "danger");
});

test("codex console mounts xterm as a read-only transcript renderer", () => {
  const consoleUrl = new URL("../src/app/companion/CodexConsole.tsx", import.meta.url);
  const terminalUrl = new URL("../src/app/companion/CodexTerminalPane.tsx", import.meta.url);
  const cssUrl = new URL("../src/app/globals.css", import.meta.url);
  const consoleSource = readFileSync(consoleUrl, "utf8");
  const terminalSource = readFileSync(terminalUrl, "utf8");
  const css = readFileSync(cssUrl, "utf8");

  assert.match(consoleSource, /<CodexTerminalPane/);
  assert.match(terminalSource, /import\("@xterm\/xterm"\)/);
  assert.match(terminalSource, /disableStdin:\s*true/);
  assert.match(css, /@import "@xterm\/xterm\/css\/xterm\.css";/);
});

test("codex prompt sends on Enter while preserving Shift+Enter newlines", () => {
  assert.equal(shouldSendCodexPromptOnKeyDown({ key: "Enter", shiftKey: false }), true);
  assert.equal(shouldSendCodexPromptOnKeyDown({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSendCodexPromptOnKeyDown({ key: "a", shiftKey: false }), false);

  const consoleUrl = new URL("../src/app/companion/CodexConsole.tsx", import.meta.url);
  const source = readFileSync(consoleUrl, "utf8");
  assert.match(source, /onKeyDown=\{handleDraftKeyDown\}/);
});

test("codex console exposes workspace selection and creation", () => {
  const consoleUrl = new URL("../src/app/companion/CodexConsole.tsx", import.meta.url);
  const apiUrl = new URL("../src/lib/codexApi.ts", import.meta.url);
  const source = readFileSync(consoleUrl, "utf8");
  const api = readFileSync(apiUrl, "utf8");

  assert.match(api, /listCodexWorkspaces/);
  assert.match(api, /createCodexWorkspace/);
  assert.match(api, /pickCodexWorkspacePath/);
  assert.match(source, /listCodexWorkspaces/);
  assert.match(source, /createCodexWorkspace/);
  assert.match(source, /pickCodexWorkspacePath/);
  assert.match(source, /aria-label="Browse Codex workspace path"/);
  assert.match(source, /Browse/);
  assert.match(source, /aria-label="Codex workspace"/);
  assert.match(source, /workspace_id: workspaceId/);
});

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

test("codexConsoleReducer keeps turn running during retry notices", () => {
  let state = createCodexConsoleState();
  state = codexConsoleReducer(state, { type: "turn_started", turn_id: "turn-2" });
  state = codexConsoleReducer(state, {
    type: "turn_retrying",
    turn_id: "turn-2",
    message: "Reconnecting... 1/5",
    will_retry: true,
  });

  assert.equal(state.status, "running_turn");
  assert.equal(state.activeTurnId, "turn-2");
  assert.equal(state.error, "");
  assert.deepEqual(state.transcript, [
    { id: "turn-2:retry:0", kind: "status", turnId: "turn-2", text: "Reconnecting... 1/5" },
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

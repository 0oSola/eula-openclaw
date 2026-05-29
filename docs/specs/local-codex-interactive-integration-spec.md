# Local Codex Interactive Integration Spec

更新时间：2026-05-29

## 0. 目标

在现有 MMD Companion 系统中接入本地 Codex 交互模式，使用户可以在产品内打开一个 Codex Console，针对本地代码仓库进行多轮代码分析、命令执行、文件修改、approval、diff review、check 和 apply。该能力不替代 OpenClaw 陪伴聊天；OpenClaw 继续负责普通对话、MMD 动作和 TTS，Codex 负责工程任务。

## 1. 当前系统约束

当前系统是 Browser / Next.js UI -> Next.js `/api/backend/*` -> FastAPI API -> 外部 OpenClaw/TTS + SQLite/NDJSON + 本地 MMD/VMD 文件的形态。前端不直接访问 OpenClaw/TTS 外部服务，而是统一经 Next.js 同源代理转发到 FastAPI。主聊天链路由 `POST /sessions/{session_id}/messages` 进入 FastAPI Message Service，随后调用 OpenClaw 并写入 SQLite。现有数据落点包括 `messages`、`message_tts`、`trace_events`、`retry_jobs` 等。

因此 Codex 也必须遵守同一边界：浏览器只连接 Next.js/FastAPI，不直接连接 Codex app-server；Codex app-server 是 FastAPI 后面的本地协议组件。

## 2. 设计决策

### 2.1 选择 Codex app-server，而不是 codex exec

交互模式需要连续 thread、流式事件、中途 approval、cancel、文件修改事件和多轮上下文。`codex exec` 更适合一次性非交互任务，不适合作为主交互体验。

### 2.2 第一版使用 stdio transport

FastAPI 启动：

```bash
codex app-server --listen stdio://
```

FastAPI 通过 stdin/stdout 与 app-server 交换 JSONL JSON-RPC 消息。第一版不开放 TCP 端口，避免 WebSocket 认证和网络暴露风险。

### 2.3 每个 Codex session 使用独立 git worktree

主仓库不直接让 Codex 修改。每个交互会话创建临时 worktree：

```text
/repo/mmd-companion
/tmp/mmd-codex-worktrees/codex_sess_123
```

Codex 在 worktree 中运行；用户 review diff、运行 checks 后，才可人工 apply 到主仓库或保留为 branch。

### 2.4 FastAPI 标准化事件

Codex app-server 原始 JSON-RPC notifications 不直接暴露给前端。FastAPI 做事件转换、权限控制、审计和落库，然后通过自己的 WebSocket 向前端发送稳定 UI 事件。

## 3. 目标架构

```text
Browser / Next.js UI
  -> Next.js /api/backend/*
    -> FastAPI API
      -> OpenClawProvider
      -> CodexInteractiveProvider
          -> CodexAppServerClient
              -> local process: codex app-server --listen stdio://
          -> CodexWorktreeManager
          -> CodexApprovalService
          -> CodexArtifactService
          -> SQLite + NDJSON trace
```

## 4. 非目标

第一版不做：

1. 浏览器直连 `ws://127.0.0.1:4500`。
2. 将终端 TUI 用 xterm.js 嵌入网页作为主方案。
3. 自动把 Codex diff apply 到主工作区。
4. `danger-full-access` / `--dangerously-bypass-approvals-and-sandbox`。
5. Cloud Codex task。
6. Codex 全局 MCP 集成。
7. 用 Codex 替换 OpenClaw 陪伴聊天主链路。

## 5. 用户体验

### 5.1 入口

在 `/companion` 右侧 rail 增加 `Codex` 或 `Tasks` 面板。普通聊天仍在 Chatbox；Codex 使用独立 Console。

也可以支持 Chatbox slash command：

```text
/codex explain 分析 Message Service 如何接 Provider，不要修改文件
/codex patch 实现 CodexInteractiveProvider 骨架
/codex review 检查当前 diff 的风险
/codex test 跑 check 并解释失败原因
```

Slash command 只负责打开或定位 Codex Console，不把长事件流塞入普通聊天气泡。

### 5.2 Codex Console 信息布局

```text
Workspace: mmd-companion
Branch: codex/codex_sess_123
Sandbox: read-only | workspace-write
Status: starting | ready | running | waiting_approval | completed | failed

Transcript:
  User message
  Codex text / plan
  Tool command
  Command output
  Approval card
  Diff summary

Actions:
  Send
  Cancel turn
  Approve once
  Deny
  View diff
  Run checks
  Apply to main workspace
  Discard session
```

## 6. 配置

```env
CODEX_INTERACTIVE_ENABLED=false
CODEX_BIN=/usr/local/bin/codex
CODEX_HOME=/var/lib/mmd-companion-codex
CODEX_TRANSPORT=stdio

CODEX_ALLOWED_USERS=admin-1,sola
CODEX_ALLOWED_WORKSPACES=mmd-companion
CODEX_WORKSPACE_MMD_COMPANION=/repo/mmd-companion

CODEX_DEFAULT_SANDBOX=read-only
CODEX_PATCH_SANDBOX=workspace-write
CODEX_ALLOW_DANGER_FULL_ACCESS=false
CODEX_ALLOW_YOLO=false

CODEX_USE_WORKTREE=true
CODEX_WORKTREE_ROOT=/tmp/mmd-codex-worktrees
CODEX_BRANCH_PREFIX=codex/

CODEX_MAX_CONCURRENT_SESSIONS=1
CODEX_SESSION_IDLE_TIMEOUT_SECONDS=1800
CODEX_TURN_TIMEOUT_SECONDS=900
CODEX_PROCESS_START_TIMEOUT_SECONDS=30
CODEX_MAX_PROMPT_CHARS=12000

CODEX_REQUIRE_GIT_REPO=true
CODEX_REQUIRE_GIT_CLEAN_FOR_APPLY=true
CODEX_REQUIRE_HUMAN_APPROVAL=true
CODEX_TRACE_REDACT_SECRETS=true
```

## 7. 数据库 schema

### 7.1 `codex_interactive_sessions`

```sql
CREATE TABLE IF NOT EXISTS codex_interactive_sessions (
  id TEXT PRIMARY KEY,
  local_chat_session_id TEXT,
  workspace_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  workspace_path TEXT NOT NULL,
  worktree_path TEXT,
  branch_name TEXT,
  codex_thread_id TEXT,
  codex_version TEXT,
  transport TEXT NOT NULL DEFAULT 'stdio',
  sandbox_mode TEXT NOT NULL DEFAULT 'read-only',
  status TEXT NOT NULL,
  process_id INTEGER,
  created_at TEXT NOT NULL,
  last_active_at TEXT NOT NULL,
  closed_at TEXT,
  error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}'
);
```

### 7.2 `codex_turns`

```sql
CREATE TABLE IF NOT EXISTS codex_turns (
  id TEXT PRIMARY KEY,
  codex_session_id TEXT NOT NULL,
  codex_turn_id TEXT,
  user_message TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  final_text TEXT,
  error TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
);
```

### 7.3 `codex_events`

```sql
CREATE TABLE IF NOT EXISTS codex_events (
  id TEXT PRIMARY KEY,
  codex_session_id TEXT NOT NULL,
  turn_id TEXT,
  sequence INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_codex_events_session_sequence
ON codex_events(codex_session_id, sequence);
```

### 7.4 `codex_approvals`

```sql
CREATE TABLE IF NOT EXISTS codex_approvals (
  id TEXT PRIMARY KEY,
  codex_session_id TEXT NOT NULL,
  turn_id TEXT,
  external_approval_id TEXT,
  action_type TEXT NOT NULL,
  title TEXT NOT NULL,
  detail_json TEXT NOT NULL,
  decision TEXT,
  decided_by TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
);
```

### 7.5 `codex_artifacts`

```sql
CREATE TABLE IF NOT EXISTS codex_artifacts (
  id TEXT PRIMARY KEY,
  codex_session_id TEXT NOT NULL,
  turn_id TEXT,
  kind TEXT NOT NULL,
  path TEXT,
  content_ref TEXT,
  summary TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  FOREIGN KEY (codex_session_id) REFERENCES codex_interactive_sessions(id)
);
```

## 8. Backend modules

```text
api/app/routes/codex_interactive.py
api/app/routes/codex_ws.py
api/app/services/codex_app_server_client.py
api/app/services/codex_interactive_provider.py
api/app/services/codex_worktree_manager.py
api/app/services/codex_event_normalizer.py
api/app/services/codex_approval_service.py
api/app/services/codex_artifact_service.py
api/app/services/codex_process_registry.py
api/app/db/codex_store.py
```

## 9. API contract

### 9.1 Create interactive session

```http
POST /codex/interactive/sessions
```

Request:

```json
{
  "local_chat_session_id": "chat_session_123",
  "workspace_id": "mmd-companion",
  "mode": "read_only",
  "sandbox": "read-only"
}
```

Response:

```json
{
  "id": "codex_sess_123",
  "workspace_id": "mmd-companion",
  "worktree_path": "/tmp/mmd-codex-worktrees/codex_sess_123",
  "branch_name": "codex/codex_sess_123",
  "status": "ready",
  "sandbox": "read-only",
  "ws_url": "/api/backend/ws/codex/interactive/codex_sess_123?user_id=admin-1"
}
```

### 9.2 WebSocket

```text
WS /ws/codex/interactive/{codex_session_id}?user_id={user_id}
```

Client -> server:

```ts
type ClientCodexEvent =
  | { type: "user_message"; text: string; mode?: "read_only" | "patch" | "review" | "test" }
  | { type: "approval_decision"; approval_id: string; decision: "approve_once" | "deny" }
  | { type: "cancel_turn" }
  | { type: "close_session" };
```

Server -> client:

```ts
type ServerCodexEvent =
  | { type: "session_ready"; session_id: string; thread_id?: string }
  | { type: "turn_started"; turn_id: string }
  | { type: "text_delta"; turn_id: string; text: string }
  | { type: "plan_delta"; turn_id: string; text: string }
  | { type: "command_started"; turn_id: string; command: string; cwd?: string }
  | { type: "command_output"; turn_id: string; stream: "stdout" | "stderr"; text: string }
  | { type: "file_changed"; turn_id: string; path: string; change_type: "created" | "modified" | "deleted" }
  | { type: "approval_required"; turn_id: string; approval_id: string; action_type: string; title: string; detail: unknown }
  | { type: "diff_ready"; turn_id: string; artifact_id: string; changed_files: string[] }
  | { type: "turn_completed"; turn_id: string; final_text: string }
  | { type: "turn_failed"; turn_id?: string; error: string }
  | { type: "session_closed"; reason: string };
```

### 9.3 Diff

```http
GET /codex/interactive/{session_id}/diff
```

Response:

```json
{
  "session_id": "codex_sess_123",
  "base_workspace": "/repo/mmd-companion",
  "worktree_path": "/tmp/mmd-codex-worktrees/codex_sess_123",
  "changed_files": ["api/app/services/codex_app_server_client.py"],
  "stat": "...",
  "patch": "diff --git ..."
}
```

### 9.4 Run checks

```http
POST /codex/interactive/{session_id}/checks
```

Request:

```json
{
  "checks": ["api", "web_basic"]
}
```

Default commands:

```bash
npm --prefix web run check:basic
pytest api/tests
```

### 9.5 Apply

```http
POST /codex/interactive/{session_id}/apply
```

Request:

```json
{
  "strategy": "patch_to_main_workspace",
  "confirm": true
}
```

Apply must require admin user, clean main workspace, human confirmation, available diff, and no unresolved approval.

## 10. Codex app-server client behavior

### 10.1 Startup

1. Validate config and user.
2. Resolve workspace from allowlist.
3. Create worktree.
4. Spawn process with env whitelist:

```python
env = {
  "PATH": os.environ.get("PATH", ""),
  "HOME": str(codex_home),
  "CODEX_HOME": str(codex_home),
  "NO_COLOR": "1",
}
```

5. Start JSON-RPC reader task.
6. Send `initialize` and then create/start thread using the schema generated for the installed CLI version.
7. Persist `codex_thread_id` and `codex_version`.

### 10.2 JSON-RPC rules

Requests include `method`, `params`, and `id`. Responses echo `id`. Notifications omit `id`. The client must maintain an in-flight request map and a notification queue.

### 10.3 Schema compatibility

At build time or startup, generate schemas from the local Codex version:

```bash
codex app-server generate-ts --out web/src/codex-schema
codex app-server generate-json-schema --out api/app/codex_schema
```

Do not hardcode unstable notification fields. Normalize based on known event categories and store unknown notifications as raw events.

## 11. Worktree manager

### 11.1 Create

```bash
git -C /repo/mmd-companion worktree add \
  /tmp/mmd-codex-worktrees/codex_sess_123 \
  -b codex/codex_sess_123
```

### 11.2 Diff

```bash
git -C /tmp/mmd-codex-worktrees/codex_sess_123 status --porcelain
git -C /tmp/mmd-codex-worktrees/codex_sess_123 diff --stat
git -C /tmp/mmd-codex-worktrees/codex_sess_123 diff
```

### 11.3 Apply

Use `git diff` from worktree and apply to main workspace only after checks and explicit confirmation:

```bash
git -C /tmp/mmd-codex-worktrees/codex_sess_123 diff > /tmp/codex.patch
git -C /repo/mmd-companion apply --check /tmp/codex.patch
git -C /repo/mmd-companion apply /tmp/codex.patch
```

Alternatively keep the branch and ask the developer to merge manually.

## 12. Security requirements

1. Browser never connects directly to Codex app-server.
2. First version uses stdio, not TCP WebSocket.
3. Only allowlisted users can create sessions.
4. Only allowlisted workspaces can be used.
5. Workspace paths must be resolved with `Path.resolve()` and must remain under the configured root.
6. Codex runs with isolated `CODEX_HOME`.
7. FastAPI must not pass OpenClaw/TTS/database/Feishu secrets to Codex.
8. Default sandbox is `read-only`.
9. Patch mode uses `workspace-write` only inside worktree.
10. `danger-full-access`, `--yolo`, and `--dangerously-bypass-approvals-and-sandbox` are forbidden in wrapper code.
11. Approval decisions must be persisted.
12. Trace and event logs must redact secrets.
13. Processes must be killed on idle timeout, cancel, or server shutdown.
14. Apply requires clean main repo and human confirmation.
15. Network exposure requires separate review; WebSocket mode must use auth and TLS/secure proxy for non-local access.

## 13. Frontend implementation

Add:

```text
web/src/lib/codexApi.ts
web/src/lib/codexEvents.ts
web/src/components/codex/CodexConsole.tsx
web/src/components/codex/CodexTranscript.tsx
web/src/components/codex/CodexApprovalCard.tsx
web/src/components/codex/CodexDiffViewer.tsx
web/src/components/codex/CodexSessionToolbar.tsx
```

State machine:

```text
idle
  -> creating_session
  -> ready
  -> running_turn
  -> waiting_approval
  -> completed_turn
  -> failed_turn
  -> closed
```

The UI should keep Codex transcript separate from OpenClaw chat messages. It may write a short assistant message to chat only when a Codex task completes, e.g. `Codex 已完成本轮分析，查看右侧任务卡。`

## 14. Observability

Add to `/admin/runtime-health`:

```json
{
  "codex": {
    "enabled": true,
    "codex_bin": "/usr/local/bin/codex",
    "codex_version": "...",
    "transport": "stdio",
    "active_sessions": 1,
    "allowed_workspaces": ["mmd-companion"],
    "last_error": null
  }
}
```

Trace event names:

```text
codex.session.create
codex.session.ready
codex.session.failed
codex.turn.start
codex.turn.event
codex.turn.completed
codex.turn.failed
codex.approval.required
codex.approval.decided
codex.diff.ready
codex.checks.started
codex.checks.completed
codex.apply.started
codex.apply.completed
codex.apply.failed
codex.process.exit
```

## 15. Acceptance criteria

### Phase 1: read-only interactive

- Admin can create Codex session from UI.
- FastAPI starts `codex app-server --listen stdio://`.
- UI receives streaming text events.
- User can send at least two turns in the same thread.
- User can cancel a running turn.
- Events are persisted in SQLite and trace.
- Session closes after idle timeout.
- No file changes are produced in read-only mode.

### Phase 2: patch mode

- Admin can start workspace-write session in worktree.
- Codex can modify files inside worktree only.
- UI shows changed files and diff.
- Approval card appears for risky actions.
- Approval decisions are persisted.
- Deny stops or redirects the requested action.

### Phase 3: checks and apply

- UI can run configured checks.
- Apply is blocked if main repo is dirty.
- Apply is blocked without explicit confirmation.
- Apply writes patch to main workspace only after `git apply --check` passes.
- Apply event is traceable.

## 16. Test plan

### Backend unit tests

- workspace allowlist path traversal rejection.
- env whitelist excludes sensitive variables.
- JSON-RPC response matching.
- unknown notification persistence.
- WebSocket event normalization.
- apply blocked on dirty repo.
- timeout kills process group.

### Integration tests

- create session -> send turn -> receive final.
- cancel turn.
- patch mode in temporary git repo -> diff visible.
- approval required -> approve/deny path.
- process crash -> UI receives `turn_failed` or `session_closed`.

### Frontend tests

- Codex console lifecycle.
- transcript streaming append.
- approval card actions.
- diff viewer renders large patch without breaking layout.
- switching right rail tabs preserves active session.

## 17. Implementation phases

### Phase 0: docs and config

- Add this spec to `docs/architecture/local-codex-interactive-integration-spec.md`.
- Add env config parser.
- Add runtime health placeholder.

### Phase 1: backend read-only bridge

- `CodexAppServerClient`.
- process registry.
- session create/close endpoints.
- FastAPI WebSocket bridge.
- event store.

### Phase 2: UI console

- create session button.
- transcript view.
- send/cancel.
- session status.

### Phase 3: worktree + diff

- worktree manager.
- patch mode.
- diff endpoint and UI.
- changed files artifact.

### Phase 4: approval + checks

- approval event normalization.
- approval card.
- checks endpoint.
- check logs artifact.

### Phase 5: apply and cleanup

- apply endpoint.
- discard/close session.
- worktree cleanup.
- runtime-health full status.

## 18. Open questions

1. Codex app-server event names and approval RPC methods should be pinned from the generated schema for the installed CLI version.
2. Whether patch mode should require explicit user switch from read-only per session.
3. Whether generated Codex summaries should mirror into `messages` or remain only in task panel.
4. Whether checks should run in worktree only or also after apply in main workspace.
5. Whether later to support Unix socket daemon for multi-session reuse.


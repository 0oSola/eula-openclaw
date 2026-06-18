# 当前系统拓扑与架构蓝图

更新时间：2026-06-18

本文用于两类场景：

1. 自己快速理解当前项目全景、服务边界和调用关系。
2. 把必要背景交给 OpenClaw、TTS、前端或渲染相关服务做优化时，让对方能先理解上下游约束。

本文只描述当前运行形态，不描述理想重构方案。令牌、密钥等敏感值不写入本文。

## 1. 一句话概览

当前项目是一个浏览器端 MMD 虚拟陪伴系统。前端由 Next.js 承载，后端由 FastAPI 负责会话、资源、OpenClaw 调用、TTS 调用、Codex 交互入口和 trace 记录。文本能力来自 OpenClaw Gateway，语音能力来自独立的 Voice Workflow TTS 服务，工程任务入口来自本地 Codex interactive provider，MMD/PMX/VMD 资源来自本地 `MMD_ROOT_DIR`。

```text
Browser / Next.js UI
  -> Next.js backend proxy /api/backend/*
    -> FastAPI API
      -> OpenClaw Gateway HTTP
      -> OpenClaw Gateway WebSocket RPC
      -> OpenClaw Control Plane HTTP
      -> Voice Workflow TTS
      -> Codex Interactive Provider (disabled by default)
      -> SQLite + NDJSON
      -> Local MMD/VMD files
```

## 2. 服务清单

| 服务 | 当前地址/位置 | 主要职责 | 当前状态 | 健康检查/验证 |
| --- | --- | --- | --- | --- |
| Next.js Web | `web/`, 默认 `http://localhost:3000` | UI、MMD 舞台、Chatbox、设置面板、trace 页面、runtime health 页面 | 本项目内 | 页面访问、`npm --prefix web run check:basic` |
| Next.js API Proxy | `/api/backend/*` | 浏览器同源转发到 FastAPI | 本项目内 | 前端请求是否 2xx |
| FastAPI API | `api/`, 默认 `http://127.0.0.1:8000`；dev-stack 默认 `http://127.0.0.1:8100` | 会话、消息、OpenClaw/TTS 代理、realtime voice WebSocket、资源、trace、admin API；默认只面向本机 loopback | 本项目内 | `GET /healthz`、`GET /admin/runtime-health` |
| OpenClaw Gateway HTTP | `http://10.11.252.164:18789` | `/v1/models`、`/v1/responses` 文本生成 | 外部服务 | `GET /healthz/openclaw` |
| OpenClaw Gateway WebSocket RPC | `ws://10.11.252.164:18789` | Feishu session 列表、history、实时消息订阅、agent/chat delta 事件 | 外部服务 | Bridge admin 状态、`sessions.list` |
| OpenClaw Control Plane HTTP | `http://10.11.252.164:8765` | Codex daily review run、snapshot push、command queue、command result | 外部服务 | OpenClaw run 状态、FastAPI outbound snapshot response |
| Voice Workflow TTS | `http://10.11.252.164:5555` | 提交 TTS、查询任务、返回音频 URL | 外部服务 | `POST /api/v1/tts` + `GET /api/v1/tasks/{task_id}` |
| Codex Interactive | FastAPI 内 `CodexInteractiveProvider`，目标进程为 `codex app-server --listen stdio://` | 产品内 Codex Console、只读/patch 多轮事件流、worktree diff、approval、checks、apply | 本项目内，默认关闭 | `GET /admin/runtime-health` 的 `codex` 字段 |
| Codex Review Sync | FastAPI `codex_openclaw_review_sync` worker + OpenClaw `/v1/responses` | 把 desktop-pet 管理的 Codex 会话 evidence pack 提交给 OpenClaw，回写 draft 工作总结/踩坑/决策/followup | 本项目内，默认关闭 | `codex_openclaw_sync_outbox` 与 `codex_review_items` |
| Codex Review Control Plane Sync | FastAPI `openclaw_control_plane` worker + OpenClaw control-plane `/v1/apps/mmd/codex-review/*` | 把本地 daily summary/draft snapshot 主动推给 OpenClaw review run，轮询审核命令并回推命令结果 | 本项目内，默认关闭 | OpenClaw `codex-review-daily:YYYY-MM-DD` run 从 `awaiting_snapshot` 进入后续状态；FastAPI `last_codex_review_control_plane_commands` |
| Codex Review Memory / OpenClaw Wiki | FastAPI review APIs/outbound worker + OpenClaw `memory-wiki` | 用户确认 draft 后把候选摘要转成结构化、可执行的长期 knowledge memory；FastAPI 主动把确认后的 Obsidian 页面 payload 推给 OpenClaw | 本项目内；OpenClaw wiki 发布在 OpenClaw 侧执行 | `codex_review_memory`、`codex_review_memory_versions`、OpenClaw review run 状态 |
| SQLite | `api/data/sqlite/trace.db` | 会话、消息、TTS、Bridge、trace、资源索引 | 本地数据 | API 查询和测试 |
| NDJSON logs | `api/data/logs/*.ndjson` | trace 双写日志 | 本地数据 | 直接查日志 |
| MMD assets | `MMD_ROOT_DIR=./MMD` | PMX/PMD 模型、贴图、VMD 动作资源 | 本地文件 | `GET /assets/mmd/models` |

## 3. 当前关键配置

```env
OPENCLAW_BASE_URL=http://10.11.252.164:18789
OPENCLAW_MODEL=openclaw
OPENCLAW_AGENT_ID=main
OPENCLAW_MESSAGE_CHANNEL=feishu
OPENCLAW_PROXY_URL=http://127.0.0.1:7897
OPENCLAW_VERIFY_SSL=true
OPENCLAW_TIMEOUT_SECONDS=120

TTS_SERVICE_ENABLED=true
TTS_SERVICE_BASE_URL=http://10.11.252.164:5555

REALTIME_VOICE_ENABLED=true
REALTIME_VOICE_MAX_QUEUE_SIZE=3
REALTIME_VOICE_CHUNK_TIMEOUT_SECONDS=30
REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD=5
REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS=60
REALTIME_VOICE_CIRCUIT_OPEN_SECONDS=120
REALTIME_VOICE_MAX_QUEUE_WAIT_SECONDS=120
OPENCLAW_STREAM_MODE=http_sse

API_DATA_DIR=api/data
MMD_ROOT_DIR=./MMD
ADMIN_USER_IDS=admin-1,sola

CODEX_INTERACTIVE_ENABLED=false
CODEX_BIN=codex
CODEX_HOME=api/data/codex-home
CODEX_TRANSPORT=stdio
CODEX_ALLOWED_USERS=admin-1,sola
CODEX_ALLOWED_WORKSPACES=mmd-companion
CODEX_WORKSPACE_MMD_COMPANION=.
CODEX_DEFAULT_SANDBOX=read-only
CODEX_PATCH_SANDBOX=workspace-write
CODEX_ALLOW_DANGER_FULL_ACCESS=false
CODEX_ALLOW_YOLO=false
CODEX_USE_WORKTREE=true
CODEX_WORKTREE_ROOT=api/data/codex-worktrees
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

CODEX_OPENCLAW_REVIEW_ENABLED=true
CODEX_OPENCLAW_REVIEW_AGENT_ID=codex-manager
CODEX_OPENCLAW_REVIEW_CHANNEL=codex-pet
CODEX_OPENCLAW_REVIEW_SYNC_INTERVAL_SECONDS=10
CODEX_OPENCLAW_REVIEW_MAX_PAYLOAD_CHARS=8000
CODEX_OPENCLAW_REVIEW_DUMP_DEBUG_FILES=false
CODEX_OPENCLAW_CONTROL_PLANE_ENABLED=true
OPENCLAW_CONTROL_PLANE_BASE_URL=http://10.11.252.164:8765
OPENCLAW_CONTROL_PLANE_TOKEN=
CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID=mmd-companion
CODEX_OPENCLAW_CONTROL_PLANE_SYNC_INTERVAL_SECONDS=60
CODEX_OPENCLAW_CONTROL_PLANE_SNAPSHOT_LIMIT=20

CODEX_REVIEW_MEMORY_ENABLED=false
CODEX_REVIEW_MEMORY_EXPORT_ROOT=api/data/openkb/codex-review
CODEX_REVIEW_MEMORY_TARGET=openclaw_wiki
OPENKB_SYNC_ENABLED=false
OPENKB_BASE_URL=
OPENKB_TOKEN=
```

当前文本生成应使用：

```text
payload.model = openclaw
x-openclaw-agent-id = main
x-openclaw-message-channel = feishu
```

不要把 `OPENCLAW_MODEL` 配成 `minimax-portal/MiniMax-M2.7`。当前 Gateway 对这种 model 名会返回无效模型或导致链路不可用。OpenClaw 默认 agent 当前走 `main`，默认模型由 OpenClaw 侧维护；MMD 项目不固定到业务专用 agent。OpenClaw `/v1/audio/speech` 当前实测为 404，实际音频链路不走这个接口。

Codex interactive 默认关闭。打开时必须配置 `CODEX_ALLOWED_USERS`；启动时的固定 workspace 仍来自 `CODEX_ALLOWED_WORKSPACES` 和对应的 `CODEX_WORKSPACE_*` 路径。浏览器不直连 Codex app-server；当前实现由 FastAPI 管理 `/companion/tasks` Codex Console、workspace 列表/登记、只读和 patch session、WebSocket 事件流、SQLite 事件/approval/artifact 落库。前端可通过 `GET /codex/workspaces` 读取 env workspace 和 UI 登记的 workspace，可通过 `POST /codex/workspaces/path-picker` 请求后端在本机拉起目录选择框并返回用户选择的绝对路径，也可通过 `POST /codex/workspaces` 登记新的本地 git 仓库根目录；后端要求 admin + Codex allowlisted user、slug workspace id、绝对路径、无 `..` traversal segment、已存在目录、且登记路径本身必须是 git repository root。UI 登记结果写入 SQLite `codex_workspaces`，不会改写 `.env`。这是对原始“configured root”措辞的有意偏离：UI 登记 repo 不要求位于 MMD 项目根目录下，安全边界由 admin+allowlist、路径 canonicalization、git root 校验和 Codex sandbox/worktree gate 共同提供。

生产 provider 会为每个 Codex session 启动本地 `codex app-server --listen stdio://`，通过 stdin/stdout JSONL JSON-RPC 调用 pinned schema 中的 `initialize`、`thread/start`、`turn/start` 和 `turn/interrupt`。app-server JSON Schema 固定在 `api/app/codex_schema/generated/`，前端 TypeScript protocol 绑定固定在 `web/src/codex-schema/generated/`，兼容层常量位于 `api/app/codex_schema/methods.py` 和 `web/src/codex-schema/methods.ts`。本地升级 Codex CLI 后用以下命令重新生成 schema bundle，并检查 diff 后再提交：

```powershell
scripts\generate-codex-app-server-schema.ps1
```

服务启动脚本 `scripts/dev-stack.ps1` 会在启动 API 前调用 `scripts/check-codex-app-server-schema.ps1`。当 `CODEX_INTERACTIVE_ENABLED=true` 时，该 preflight 会读取本地 `codex --version`、`api/.env`/环境变量中的 `CODEX_BIN`、以及 pinned manifest；schema 缺失或版本不一致时默认 fail fast，并提示手动运行生成脚本。开发环境如果确实要在启动时自动刷新 schema，可显式设置 `CODEX_SCHEMA_AUTO_UPDATE=true`，此时 preflight 会调用 `scripts\generate-codex-app-server-schema.ps1`；生产或正常启动不应静默自动更新 repo 文件。

FastAPI 只给 app-server 传白名单环境变量：`PATH`、`HOME`、`CODEX_HOME`、`NO_COLOR`，以及 Windows 网络/TLS/用户目录运行所需的 `SystemRoot`、`WINDIR`、`COMSPEC`、`PATHEXT`、`TEMP`、`TMP`、`USERPROFILE`、`APPDATA`、`LOCALAPPDATA`、`PROGRAMDATA`。不会传 OpenClaw、TTS、数据库、Feishu、OpenAI API key 或其他项目密钥。Windows 上如果 `CODEX_BIN` 解析到 npm 的 `codex.cmd` shim，后端会优先定位同包内的 native `codex.exe` 再启动，避免 shim 进程的 stdio/lifecycle 问题；找不到 native executable 时才退回 shim。运行时仍只支持本地 stdio app-server transport；不暴露浏览器直连 app-server，不启用 TCP/WebSocket app-server transport、Cloud Codex、Codex MCP、真实 PTY/xterm shell embedding、auto-apply 或 approval bypass。前端 `/companion/tasks` 的 Codex Console 仅使用 xterm.js 作为只读 transcript 渲染器，把后端 WebSocket UI 事件格式化显示为终端行；它不接入本地 shell，不向浏览器暴露 Codex app-server stdin/stdout，也不改变审批、diff、checks、apply 的现有 API 边界。Codex prompt 输入框采用聊天式快捷键：`Enter` 发送当前 turn，`Shift+Enter` 保留换行编辑。

Patch session 会通过 `CodexWorktreeManager` 在 `CODEX_WORKTREE_ROOT` 下为当前选中的 workspace 创建独立 git worktree，sandbox 固定为 `workspace-write`；read-only session 在当前选中的 env 或 SQLite 登记 workspace 下运行，sandbox 固定为 `read-only`。`CODEX_MAX_CONCURRENT_SESSIONS` 在创建 session 前强制执行；执行前会按 `CODEX_SESSION_IDLE_TIMEOUT_SECONDS` 关闭超时 idle session，并同步关闭 provider runtime、更新 SQLite session status、写入 lifecycle trace。FastAPI shutdown 会调用 provider `close_all_sessions()` 关闭仍活跃的本地 Codex runtimes。turn request 或 event stream 超时会稳定产出 `turn_failed`，app-server stdout/process 关闭会产出 `session_closed`/`process_exit`，并把 session 标记为 failed 且写入 runtime-health last error。

app-server notification 会在 FastAPI 归一化为稳定 UI 事件，例如 `item/agentMessage/delta -> text_delta`、`item/plan/delta -> plan_delta`、`item/commandExecution/outputDelta -> command_output`、`item/fileChange/patchUpdated -> file_changed`、`turn/completed -> turn_completed`、`process/exited -> process_exit`。`error` notification 只有在 `willRetry=false` 时归一化为终态 `turn_failed`；`willRetry=true` 的临时连接恢复提示归一化为非终态 `turn_retrying`，继续保持当前 turn running 并等待后续完成或最终失败。未知 app-server notification 继续以 `raw_codex_event` 原样落 SQLite，避免 schema drift 造成事件丢失。app-server 发起的 approval server request，例如 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`，以及旧式 `execCommandApproval`、`applyPatchApproval`，会先落 SQLite，再等待前端 approve/deny；用户决策会通过同一个 JSON-RPC request id 回传给 app-server。approval 决策既支持 REST `POST /codex/interactive/{session_id}/approvals/{approval_id}`，也支持 Codex WebSocket `{ type: "approval_decision", approval_id, decision }`。

Diff/check/apply 都围绕 worktree 执行；patch turn 完成后会自动生成 diff artifact，也支持前端手动刷新 diff。Apply 必须满足无 unresolved approval、显式 `confirm=true`、主 workspace 干净，并通过 `git apply --check` 后才会把 patch 写回主 workspace。Codex lifecycle 同时写入 `codex_events` 和通用 `trace_events`/NDJSON，覆盖 `codex.session.create|ready|failed`、`codex.turn.start|event|completed|failed`、`codex.approval.required|decided`、`codex.diff.ready`、`codex.checks.started|completed`、`codex.apply.started|completed|failed`、`codex.process.exit`；当 `CODEX_TRACE_REDACT_SECRETS=true` 时，trace payload 中 secret-like key 或 `TOKEN=...`/`SECRET=...` 等字符串值会先被替换为 `[REDACTED]`。测试可通过 `codex_use_deterministic_provider` 覆盖使用 deterministic provider，不启动真实 app-server。

Codex Review Sync 是 desktop-pet/Codex 管理回顾链路，不是执行链路。desktop-pet 继续扫描用户既有 `CODEX_HOME/sessions/**/rollout-*.jsonl`，但只抽取 bounded facts 到 `desktop_pet_sessions.metadata.facts`，例如 failed commands、changed files、approval titles、error excerpts 和 event counts，不把完整 transcript 写入 SQLite。FastAPI 在 review-worthy status（`completed`、`failed`、`waiting_approval`、`file_changed`）上报后，若 `CODEX_OPENCLAW_REVIEW_ENABLED=true` 且存在 `OPENCLAW_TOKEN`，会用 `codex_review_fact_extractor` 合并 `desktop_pet_sessions`、`codex_events`、`codex_artifacts` 和 `codex_approvals` 生成 `codex_review_evidence_pack`，按 hash 写入 `codex_openclaw_sync_outbox`。`POST /desktop-pet/sessions` 如果收到旧版/本地 JSONL scanner payload 且 `workspace_id` 缺失，会默认归入 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID`，避免 review drafts 因 workspace 为空而从 OpenClaw daily snapshot 中消失。后台 worker 调用 OpenClaw `/v1/responses`，发送前按 `CODEX_OPENCLAW_REVIEW_MAX_PAYLOAD_CHARS` 对 evidence pack 做 best-effort 裁剪，并使用 `x-openclaw-agent-id=CODEX_OPENCLAW_REVIEW_AGENT_ID`、`x-openclaw-message-channel=CODEX_OPENCLAW_REVIEW_CHANNEL`、`x-openclaw-session-key=codex-review:{pet_session_id}`，要求 OpenClaw 返回单个 JSON object，且 prompt 内明确 `work_summary` object、各 item list 和 `management` object 的 shape。Codex review JSON key、枚举、命令、文件路径、代码标识和引用的错误原文保持英文/原文，但 `title`、`summary`、`description`、`symptom`、`root_cause`、`fix`、`prevention`、`decision`、`result`、`work_done`、`management` 等用户可读字段要求输出简体中文。FastAPI 解析层会把 OpenClaw 偶发返回的 scalar/null `work_summary`、null list 或 null `management` 归一化为可保存结构，避免单个格式偏差导致整条 outbox 永久失败；解析成功后拆成 `codex_review_items(status=draft, source=openclaw)`。`CODEX_OPENCLAW_REVIEW_DUMP_DEBUG_FILES=true` 时，请求/响应 debug JSON 写入 `API_DATA_DIR/openclaw/codex-review/`，默认关闭。OpenClaw 不读取本机 Codex 文件、不接收完整 diff/patch、不直接 resume Codex、approve 权限或 apply patch。

当前已实现的 Codex review memory 流程由 FastAPI 持有状态机。本地 review API 仍可用于 Web/Pet/manual 工具：`GET /codex/reviews/daily-summary` 获取每日数量摘要，`GET /codex/reviews/drafts` 拉取待确认 draft，`POST /codex/reviews/items/{item_id}/decision` 写入 `accept`、`edit_accept`、`ignore` 或 `snooze` 决策。`decision` payload 现在在兼容旧 `edited_title` / `edited_summary` 的同时，支持优先级更高的结构化 `memory_draft`；该结构只允许出现在 `accept` / `edit_accept`，要求至少包含 `knowledge_kind`、`problem`、`when_to_use`、非空 `steps`、非空 `verification`、`source_summary`，且 `steps[*].order`、`verification[*].order` 必须从 1 开始严格递增。`edit_accept` 现在允许仅携带 `memory_draft` 而不强制依赖 legacy summary 字段。生产跨机设计不要求 OpenClaw 反连本机 FastAPI；OpenClaw 侧提供 review run / command queue，FastAPI outbound worker 每轮先主动推送 daily snapshot，再调用 `GET {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/commands?cursor=...` 轮询命令，在本地应用 `review_decision` 后调用 `POST {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/commands/{command_id}/result` 回推 `{ session_key, command_id, status, result, error, completed_at }`。FastAPI 当前支持的 control-plane command 类型是 `review_decision`，动作与本地 API 一致：`accept`、`edit_accept`、`ignore`、`snooze`；control-plane `review_decision` 使用与本地 API 相同的 `memory_draft` 校验规则。成功结果的 `result` 包含 `item_id`、`item_status` 和可选 `memory_id`，失败结果回传错误文本。command cursor 保存在进程内 `app.state.last_codex_review_control_plane_command_cursor`，最近一次处理结果保存在 `app.state.last_codex_review_control_plane_commands`。

daily snapshot 推送由 `CODEX_OPENCLAW_CONTROL_PLANE_ENABLED` 控制，目标是 `POST {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/snapshot`，token 默认复用 `OPENCLAW_TOKEN`，也可用 `OPENCLAW_CONTROL_PLANE_TOKEN` 覆盖。snapshot 构建时会把历史 `desktop_pet_sessions.workspace_id IS NULL` 的 unscoped draft 临时视为当前 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID`，本地 `/codex/reviews/drafts?workspace_id=...` API 仍保持严格 workspace 过滤。snapshot 现在包含四层语义：`drafts` 是兼容旧 OpenClaw 审核队列的逐条 draft；`work_units` 按 `pet_session_id` 聚合 goal/outcome/status、review item counts、top review items、changed files 和 checks/failures，用于项目工作总结；`learning_candidates` 从 blocker/pitfall/decision/followup/work_summary draft 派生 problem/root_cause/fix/prevention/lesson/证据，用于 OpenClaw 让用户确认哪些经验值得沉淀；`rollup` 汇总 work unit count、状态分布、review item/candidate 类型分布、高优先级 candidate 数、top tags、changed files、失败命令数和成功检查数，作为 OpenClaw 日报和复盘入口。空 title-only/无摘要/无证据的 draft 仍保留在 `drafts`，但不会进入 `learning_candidates`，避免污染经验沉淀候选。`work_units`、`learning_candidates` 和 `rollup` 都是 outbound snapshot 的派生视图，不直接写入 memory-wiki；只有用户确认后 FastAPI 才创建 memory。`accept` 和 `edit_accept` 会创建去重的 `codex_review_memory` 行，并在 `codex_review_memory_versions` 写入版本 1；如果决策 payload 带有 `memory_draft`，FastAPI 直接把它作为 canonical `details_json` 持久化，并优先用它渲染 memory `body`，不会再从 `edited_summary` 或 review summary 反推结构。未携带 `memory_draft` 时，仍保留旧的 summary-only 兼容路径，把 review draft 的 `summary/symptom/root_cause/fix/prevention/decision/result` 等候选信息归一化成结构化 knowledge memory。当前 body 渲染支持 `Problem`、`Root Cause`、`When To Use`、`Prerequisites`、`Steps`、`Verification`、`Cautions`、`Open Questions`、`Source Summary` 等分节，并会把 per-step `commands`、`file_refs`、`evidence_refs` 和 verification `expected_signal` 写入 Markdown。也就是说，`codex_review_items` 继续是待审核摘要候选，`codex_review_memory` 才是确认后的可执行知识沉淀；两者不复用同一语义层。历史 unscoped item 被确认时也使用当前 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID` 作为 memory workspace，避免落到 `unknown`。后续编辑通过 append-only version 记录 `title/body/details_json`，不覆盖历史版本。`snooze` 的 `snooze_until` 保存在 review item details 中，未到期的 snoozed item 不会出现在 drafts 列表。默认 decision target 是 `openclaw_wiki`，所有本地 review API 目前使用 `x-user-id`，且必须命中 `ADMIN_USER_IDS`。

长期记忆主路径是 OpenClaw `memory-wiki` + Obsidian Git vault。FastAPI 会为已确认 memory 生成 bounded wiki payload，包括 deterministic wiki path、frontmatter、Markdown、结构化 `memory.details`、evidence refs 和 provenance；本地 `GET /codex/reviews/memory/{memory_id}/wiki-payload` 仍作为渲染/调试入口，生产跨机链路由 FastAPI outbound worker 扫描 `codex_review_memory.export_status='pending'` 的记录并调用 `POST {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/memory-payloads` 主动推送 `{ payloads: [...] }`。OpenClaw ack 后 FastAPI 把本地 memory 标记为 `export_status='submitted'`，表示 payload 已交给 OpenClaw，但还不代表 Obsidian wiki 已发布；随后 worker 调用 `GET {OPENCLAW_CONTROL_PLANE_BASE_URL}/v1/apps/mmd/codex-review/runs/codex-review-daily:YYYY-MM-DD/publish-status?cursor=...` 轮询发布状态，OpenClaw 返回 `published` 时本地标记 `export_status='synced'` 并把 `wiki_path` 保存为 `openkb_document_id` 兼容字段，返回 `failed` 时标记 `export_status='export_failed'` 并保存错误。payload 会脱敏 secret-like 文本，不包含完整 transcript 或本地文件路径。OpenClaw 侧负责 `wiki_apply`、`wiki_lint`、dashboard 更新、每日 git commit 和 push，并暴露 publish status 供 FastAPI 轮询。兼容导出路径仍由 `POST /codex/reviews/memory/export` 提供：FastAPI 可把确认后的 memory 渲染成 Markdown frontmatter 文件，默认目录为 `CODEX_REVIEW_MEMORY_EXPORT_ROOT/{workspace_id}/{category}/...md`；前置正文就是结构化 knowledge memory 本体，而不是 review summary 原文。请求 `target=openkb` 且 `OPENKB_SYNC_ENABLED=true` 时，FastAPI 再通过 `OpenKbClient.upsert_document()` 调用 `OPENKB_BASE_URL`。OpenKB/Markdown export 不接收 draft item，不接收未确认 memory。

本地 Codex Tool facade 当前暴露在 `/openclaw/tools/codex/*`，它是 FastAPI 执行 OpenClaw Codex tool command 时复用的受控入口，不替代浏览器 `/codex/interactive/*`。生产跨机链路应由 OpenClaw 把 Codex tool request 写入 OpenClaw command queue，FastAPI outbound worker 轮询后调用本地 facade；不要求 OpenClaw 直接访问本机 `/openclaw/tools/codex/*` URL。`POST /openclaw/tools/codex/sessions` 复用现有 Codex interactive session 创建逻辑，因此仍执行 admin、`CODEX_ALLOWED_USERS`、workspace allowlist、sandbox、worktree 和 provider 初始化校验；`GET /openclaw/tools/codex/sessions/{session_id}/status` 只返回 bounded session snapshot，包括 session/status、last output preview、pending approval refs、latest artifact refs 和 recent event headers，不返回完整 transcript、artifact metadata 或本地文件路径；`POST /openclaw/tools/codex/approvals/{approval_id}/decision` 复用现有 approval 决策逻辑。MMD project 是 OpenClaw 的 application channel/domain；LLM/model backend 只是 OpenClaw 在该 channel 内使用的能力之一。

## 4. 主调用链：前端发消息

```text
User sends message in Chatbox
  -> web/src/lib/api.ts postSessionMessage()
  -> POST /sessions/{session_id}/messages
  -> FastAPI Message Service
  -> SQLite insert user message
  -> OpenClawClient.stream_reply() when OPENCLAW_STREAM_MODE=http_sse
  -> POST {OPENCLAW_BASE_URL}/v1/responses stream=true
  -> normalize_assistant_reply()
  -> SQLite insert assistant message
  -> resolve motion action against favorite VMD assets
  -> optional TTS flow
  -> response returns user_message + assistant_message
  -> frontend updates Chatbox and MMD stage
  -> Chatbox receives chatAutoScrollRevision and scrolls the normal-flow message list to latest for the optimistic user message and assistant reply
```

如果当前 Chatbox 会话来自 OpenClaw Bridge 绑定，`sessions.openclaw_session_key` 必须等于 Bridge 的 `external_session_key`，也就是 Feishu session key。这样用户从本项目继续发送文本时，HTTP `/v1/responses` 会通过 `x-openclaw-session-key` 回到同一个 Feishu channel 会话，而不是创建本地 `openclaw:{uuid}` 分支。

Companion 顶栏只常驻显示 `USER` 和短 `SESSION`，不再把长会话 title/Feishu 标识直接铺在 header 上。完整当前会话标识由右侧 `#` 浮窗在 hover/focus 时展示，优先取 `sessions.openclaw_session_key`，否则回退到本地 session id 和会话 title。`#` 按钮和浮窗之间保留透明 hover 桥接区域，且浮窗本身允许 pointer events，因此鼠标可以从按钮移动到浮窗内容上继续查看。

核心文件：

| 层 | 文件 |
| --- | --- |
| 前端 API 包装 | `web/src/lib/api.ts` |
| Message Service | `api/app/routes/message_service.py` |
| OpenClaw HTTP client | `api/app/services/openclaw_client.py` |
| 回复解析 | `api/app/services/response_parser.py` |
| 数据存储 | `api/app/db/store.py` |

失败行为：

| 失败点 | 当前行为 |
| --- | --- |
| OpenClaw 调用失败 | 写入 fallback assistant message，`degraded=true`，写 retry job |
| OpenClaw `/v1/responses` 读超时 | 主消息链路默认走 `stream=true`；收到完整 JSON 后立即返回，不强等 `response.completed`；若 stream 超时但已有内容，会以 partial 结果继续解析，避免直接丢弃；非流式/关闭 streaming 时不做同请求立即重试 |
| OpenClaw 空内容 | 视为失败，进入 fallback |
| 回复 JSON 不完整 | `normalize_assistant_reply()` 做兼容，缺动作时 fallback idle |
| 动作无法匹配 VMD | `motion_resolution.status=fallback_idle`；只要后端没有给出 `resolved_asset_url/resolved_asset_id`，前端会随机抽取当前模型 `00_idle_loop` 中的 VMD 作为兜底；没有 idle VMD 时才回退默认 procedural idle |

## 5. 音频服务调用链

当前音频由独立 Voice Workflow TTS 服务提供，不由 OpenClaw `/v1/audio/speech` 提供。

### 5.1 消息内 TTS

```text
POST /sessions/{session_id}/messages
  with tts_enabled=true
    -> create assistant message
    -> VoiceWorkflowTtsClient.submit_task()
       POST {TTS_SERVICE_BASE_URL}/api/v1/tts
    -> wait_for_reference(TTS_SYNC_WAIT_SECONDS)
       GET {TTS_SERVICE_BASE_URL}/api/v1/tasks/{task_id}
    -> if completed:
         message_tts.status=ready
         remote_audio_url saved
       else:
         message_tts.status=pending
         tts_jobs enqueue
         background worker continues polling
```

后台 worker：

```text
run_message_tts_worker()
  -> claim_next_tts_job()
  -> GET /api/v1/tasks/{task_id}
  -> completed: finalize_message_tts(status=ready)
  -> failed: finalize_message_tts(status=failed)
  -> pending/processing: reschedule_tts_job()
```

`pending`/`processing` 是 TTS 服务的非终态。后台 worker 不再因为本地轮询次数达到 `TTS_SERVICE_MAX_POLL_ATTEMPTS` 就把任务置为 failed；只有 TTS 服务显式返回 `failed`，或状态查询连续异常达到阈值时，才会失败。这样较长文本可以继续排队等待完成。

播放代理：

```text
Frontend sees assistant_message.tts.proxy_audio_url
  -> GET /api/backend/tts/proxy/{tts_id}?user_id={user_id}
  -> FastAPI fetches remote_audio_url
  -> returns audio bytes to browser
```

浏览器 `<audio>` 不能附带 `x-user-id` header，因此消息内 TTS proxy 同时接受 `?user_id=...`。前端播放顺序优先使用 `proxy_audio_url` 经 Next.js `/api/backend/*` 同源代理访问；只有代理播放失败时才回退到 `remote_audio_url`，避免浏览器直接访问 TTS 内网地址。

Bridge 会话中的前端消息刷新不只比较 message id，也会比较消息内容和 TTS 引用签名（`tts.status`、`remote_audio_url`、`proxy_audio_url`、`task_id`、`error` 等）。因此长文本 TTS 先返回 `pending`、后台 worker 后续写成 `ready` 时，即使 message id 不变，Chatbox 也会用服务端最新消息覆盖本地旧状态，并拿到可播放的音频代理 URL。

### 5.2 直接 Server TTS

```text
Frontend requestServerTts()
  -> POST /tts/speak
  -> VoiceWorkflowTtsClient.synthesize()
  -> submit task
  -> poll until completed
  -> download audio
  -> FastAPI returns audio bytes
```

### 5.3 Realtime Voice 侧链路

Phase 1 已接入为“消息服务主链路 + 语音 WebSocket 侧链路”：

```text
POST /sessions/{session_id}/messages with tts_enabled=true
  -> Message Service 保存 user/assistant message
  -> 长任务 message_tts 仍作为 fallback 兜底
  -> frontend prepareAndPlayAssistantTts()
  -> WS /ws/sessions/{session_id}/voice?user_id={user_id}
  -> send synthesize(message_id, job_id, text)
  -> FastAPI session voice queue
  -> VoiceWorkflowTtsClient.synthesize_chunk()
     POST {TTS_SERVICE_BASE_URL}/api/v1/tts/chunk
  -> in-memory realtime chunk registry
  -> audio_ready(job_id, sequence, audio_url)
  -> frontend AudioQueue ordered playback
  -> GET /api/backend/tts/proxy/realtime/{session_id}/{job_id}/{sequence}?user_id={user_id}
  -> FastAPI fetches remote chunk audio and returns bytes
```

当前前端策略：

- 同一时间只播放一个 realtime chunk，按 job 首次入队顺序 + sequence 顺序播放。
- Companion 页面采用前端音频互斥策略：任意新的消息 TTS、浏览器朗读、realtime voice 或右侧每日播客开始播放前，都会先停止旧的播放源，保证同一页面内只有一个语音/音频在播放。
- 新的 realtime voice job 发送前会取消旧 realtime queue 并向 WebSocket 发送 `cancel(scope="all")`；取消后的旧 job id 会被前端记录，后续晚到的 `audio_ready/error/done` 事件会被忽略，避免旧片段在新语音之后重新响起。
- 右侧每日播客 `<audio>` 会向 Companion 页面注册 stop 回调；播放播客前会先停止消息 TTS、浏览器朗读和 realtime voice，播放消息语音或 realtime voice 前也会停止播客。
- 会话切换、新建会话、组件卸载会发送 `cancel(scope="all")` 并清空本地 AudioQueue。
- chunk 播放前失败时自动回退到长任务 `message_tts`；已经播放过部分 chunk 后失败时标记 `partial_failed`，不自动重播完整语音。
- realtime chunk 合成出现未预期异常时，WebSocket 返回 `error { message_id, job_id, detail }`，前端按“未播放 chunk”路径回退到长任务 `message_tts`。

## 6. OpenClaw Bridge 调用链

Bridge 是“同步 OpenClaw/Feishu 已有会话消息到本地”的链路，不是前端发消息的主链路。

```text
FastAPI lifespan
  -> if admin_user_ids and OPENCLAW_TOKEN:
       MessageBridgeService.run_forever(admin_user_ids[0])
         -> OpenClawGatewayProvider.connect()
         -> WebSocket RPC connect
         -> sessions.list
         -> prefer Feishu direct sessions, then choose latest updated_at
         -> resolve local session by external_session_key
            -> first reuse a local session that already has message_bridge messages for the same key
            -> otherwise reuse an existing binding session for the same key
            -> otherwise create a new local session
         -> create/update local binding
         -> chat.history(limit=100)
         -> insert messages into local SQLite
         -> sessions.messages.subscribe
          -> receive session.message events
          -> insert realtime messages into local SQLite
```

Bridge 创建或修复默认 binding 时，会让本地 `sessions.openclaw_session_key` 对齐到 `message_bridge_bindings.external_session_key`。启动自动选择默认 binding 时，如果当前默认 binding 已经是 `agent:<agent_id>:feishu:direct:<target_id>` 形式的 Feishu 私聊 session，且该 session 仍出现在 OpenClaw sessions 列表中，后端会保留这个 direct 默认绑定，避免 WebSocket 重连或自动 ensure 把前端会话漂移到 `agent:main:main`。只有不存在可用的既有 direct 默认绑定时，后端才会优先选择 direct session 并按 `updated_at` 选择最新项；不存在 direct session 时才回退到 `agent:main:main`、subagent、group 等其他 session。切换默认 binding 或启动自动选择 session 时，后端会先查本地 `messages.metadata.external_session_key`，如果已有同一外部会话的 Bridge 消息，会复用该历史 `local_session_id`，避免把同一个 Feishu 私聊切到一个新的空本地 session。只有找不到历史消息和既有 binding session 时，才创建新的本地 session；随后仍会调用 `chat.history(limit=100)` 拉取远端历史。前端启动后会静默读取 Bridge 状态；当 Bridge 启用且存在默认 binding 时，Chatbox 会自动打开该 binding 的 `local_session_id`，再按 `MESSAGE_BRIDGE_POLL_INTERVAL_MS` 刷新消息。Bridge 轮询刷新会用本地当前消息 id 与服务端消息 id 对比出新增项；如果新增项来自 Dashboard/Feishu 远端同步，前端会触发 `chatAutoScrollRevision` 滚到最新，避免消息已入库但停留在历史滚动位置导致看起来“没拿到”。这样 Feishu channel、OpenClaw HTTP 生成链路和当前 UI 会话会落在同一个 session key 上。

`POST /admin/message-bridge/bindings/default` 的主路径是“更新默认 binding -> 对齐本地 session key -> 拉取 `chat.history` -> 前端打开本地 session”。`sessions.messages.unsubscribe/subscribe` 只负责后续实时增量订阅刷新；如果这一步 RPC 报错，后端会记录 `message_bridge.openclaw.unsubscribe` 或 `message_bridge.openclaw.subscribe` 的 error trace，并把 `message_bridge_state.websocket_status` 标为 `reconnecting`、`last_error` 写入错误原因，同时关闭当前 provider 连接，让后台 `run_forever` 重新建连并重新订阅；接口仍返回新的 binding，避免历史消息已经同步成功却因为订阅刷新异常导致前端不打开会话。

Bridge 实时 consumer 不只依赖 `sessions.messages.subscribe` 推送。`_consume_events()` 等待实时事件时，每隔约 15 秒会对当前默认 binding 调用一次 `chat.history(limit=20)`，以 `source=realtime_backfill` 写入本地。这样 Dashboard/Feishu 侧更新了同一个 OpenClaw session 但 WebSocket subscription 漏推时，本地最多延迟一个 backfill 周期也会补齐；写入仍走 `openclaw_message_id` 去重。

当本项目在 Bridge 绑定会话里通过 HTTP `/v1/responses` 发送消息时，OpenClaw/Feishu 侧可能同时通过 Bridge WebSocket 回流同一条 user/assistant 消息。后端会把本项目主链路插入的带 `trace_id` 消息作为权威展示消息：Bridge ingest 若发现同 session 近期已有同 role/content 的本地 trace 消息，会跳过该回声；Message Service 完成本次 user/assistant 落库后，也会软删除本次请求期间已经写入的同 `openclaw_session_key` Bridge 回声；`GET /sessions/{session_id}/messages` 和 Message Service 组装 OpenClaw history 时还会做列表层兜底过滤，隐藏 5 分钟窗口内同 session、同 role、同内容、无 `trace_id` 且 `metadata.source=message_bridge` 的 echo。OpenClaw WebSocket 有时会为同一条 Feishu 实时消息给出两个不同 external id；Bridge ingest 对 `realtime`/`realtime_backfill` 的同 external session、同 role、同内容、30 秒窗口重复项做语义去重，覆盖约 15 秒一次的 backfill 延迟回放；Chat API 也会对已经落库的近邻重复项做展示兜底过滤。原始 Bridge 消息仍保留在 SQLite，方便排障，但 Chatbox 不再展示这些重复项。

Bridge ingest 会保留 OpenClaw 原生隐藏字段 `openclawMetadata`，并在 `openclawMetadata.source == "greeting-cron"` 时写入本地 `messages.metadata.openclaw_metadata`、`messages.metadata.greeting_cron` 和 `messages.metadata.auto_tts=true`。如果历史消息没有原生 metadata，后端会读取 `OPENCLAW_GREETING_DASHBOARD_INDEX_PATH` 指向的 JSONL 旁路索引，默认路径为 `api/data/openclaw/greeting-dashboard-injections.jsonl`；按 `dashboardSessionKey` 加 `dashboardMessageId`/`feishuMessageId`、正文或 180 秒时间窗口 join 后，把问候来源补到本地 metadata。匹配到 `auto_tts=true` 且消息尚无 `message_tts` 时，Bridge 会调用同一套 `message_tts` 长任务链路提交 Voice Workflow TTS；同步等待超时则写入 pending 引用和 `tts_jobs`，由后台 worker 继续轮询。

`messages.visibility` 是 Chat API 的展示边界，默认值为 `chat`。Bridge 同步到的内部控制事件仍落库，但会写为 `visibility=internal` 并在 metadata 中标记 `message_kind=control`、`control_reason`；当前包括 `system: Compaction` 和 assistant 失败占位 `[assistant turn failed before producing content]`。`GET /sessions/{session_id}/messages` 通过 SQLite 索引 `(workspace_id, account_id, session_id, deleted_at, visibility, created_at)` 只查询 `visibility=chat` 的消息，因此 Chatbox 默认不展示内部控制消息；`list_messages()`、Bridge/debug/health 相关读取仍可查看原始落库消息。

Bridge 不再落库 OpenClaw assistant 空消息占位。当外部 assistant 消息正文为空，且本地解析结果为 `parse_mode=empty` 时，后端只写 `message_bridge.openclaw.message.skipped` trace，reason 为 `empty_assistant_message`，不会把 `I am here. Let's keep going.` 这类本地 fallback 文案写入 `messages`。

Admin API：

| Endpoint | 作用 |
| --- | --- |
| `GET /admin/message-bridge/status` | 查看 Bridge 状态和当前绑定 |
| `PATCH /admin/message-bridge/settings` | 开关 Bridge 和实时驱动 |
| `GET /admin/message-bridge/openclaw/feishu/sessions` | 列出 OpenClaw Feishu sessions |
| `POST /admin/message-bridge/bindings/default` | 切换默认绑定 |
| `GET /admin/runtime-health` | 只读本地运行状态快照：API 进程、OpenClaw 配置、Bridge 状态/绑定/最新消息、TTS 队列、SQLite 计数、recent error trace |

Codex Interactive API：

| Endpoint | 作用 |
| --- | --- |
| `GET /codex/workspaces` | 列出 env 配置的 Codex workspace 和 SQLite 中 UI 登记的 workspace |
| `POST /codex/workspaces/path-picker` | 由后端在本机拉起目录选择框，返回用户选择的 workspace 路径或 `null` |
| `POST /codex/workspaces` | 由 admin allowlisted 用户登记新的本地 git repo root workspace，写入 `codex_workspaces` |
| `POST /codex/interactive/sessions` | 创建只读或 patch Codex session；patch 模式会创建独立 git worktree |
| `WS /ws/codex/interactive/{session_id}` | Codex Console 事件流，支持 user message、cancel、approval decision、close |
| `GET /codex/interactive/{session_id}/diff` | 从 session worktree 读取 changed files、stat 和 patch，并写入 diff artifact |
| `POST /codex/interactive/{session_id}/approvals/{approval_id}` | 持久化 `approve_once` 或 `deny` 决策、写入 approval event，并回传给 app-server |
| `POST /codex/interactive/{session_id}/checks` | 在 worktree 内运行后端配置的 checks，并写入 checks artifact |
| `POST /codex/interactive/{session_id}/apply` | 在 approval/clean/confirm/apply-check gate 后，把 worktree patch apply 到主 workspace |
| `POST /codex/interactive/{session_id}/discard` | 关闭 session，并按请求移除对应 worktree |
| `POST /codex/reviews/sessions/{pet_session_id}/enqueue` | 手动为指定 desktop-pet Codex session 生成 evidence pack 并写入 OpenClaw review outbox |

`GET /messages/greetings/latest` 会从本地 SQLite 查当前用户最新一条 `metadata.greeting_cron` 或 `metadata.auto_tts=true` 的 assistant 消息，并返回同一个 message response 结构（含 `tts` 引用）。Companion 页面进场时会调用该接口，气泡优先显示这条问候文本；如果该消息的 `tts.status=ready` 且有 `remote_audio_url` 或 `proxy_audio_url`，前端会在本页会话内只自动播放一次对应语音。找不到问候消息时，气泡回退到当前 Chatbox 最新 assistant 消息或默认文案。

`GET /admin/runtime-health` 不主动调用 `sessions.list`，因此 OpenClaw Gateway WebSocket 握手慢或 Feishu session list 不稳定时，健康后台仍能打开并显示本地已经收到的消息、最后连接时间、最新错误和 TTS/SQLite 状态。Codex health 同样是只读快照，不会为了探测版本而启动 Codex；`codex.codex_version` 来自已 prepare 的真实 app-server session 或 SQLite 中最近的非空版本，`codex.last_error` 来自 provider/runtime 或 SQLite session error，`codex.workspaces` 同时列出 env workspace 和 SQLite UI-mounted workspace。前端 `/status` 页面每 5 秒读取一次该接口；Companion 页面里的 Bridge 状态加载也已经把 `GET /admin/message-bridge/status` 和 `GET /admin/message-bridge/openclaw/feishu/sessions` 解耦，后者超时只会标记 session list 不可用，不会清空本地 Bridge status，也不会停止 2.5 秒一次的消息刷新轮询。`/admin/message-bridge/openclaw/feishu/sessions` 失败时返回 502，并写入 `message_bridge.openclaw.sessions.list` error trace，避免 ASGI 500 堆栈遮蔽根因。

Bridge 依赖 OpenClaw WebSocket RPC 的 operator 权限和 scopes：

```text
operator.admin
operator.read
operator.write
operator.approvals
operator.pairing
```

Cron 问候正文仍来自 OpenClaw/Feishu history 或 `OPENCLAW_GREETING_DASHBOARD_INDEX_PATH` 旁路索引，API 不会用 Voice Workflow 的 `.txt` 覆盖 `messages.content`。Cron 问候语音优先走远程 Voice Workflow 接口 5：`metadata.greeting_cron.audioFile` 或 `textFile` 存在时，后端只接受包含 `/eula_emotion_revelation/` 的 Voice 存储绝对路径、明确相对存储路径，或明确文件名兜底。`audioFile` 是 `.ogg`/`.wav` 时优先按 metadata 的真实音频路径探测，例如 `关心温柔/afternoon_20260518_1400.ogg`；如果该路径短时间内仍不可用，再尝试同名前缀 `.wav` 兜底。`textFile` 和 `.meta.json` 仍推导为同名前缀 `.wav`。后端会用 ranged GET 轻量探测 `{TTS_SERVICE_BASE_URL}/api/v1/eula-storage-audio/{path}`，每个候选路径最多短重试 3 次；重试等待按线性累加，基准值为 `min(TTS_SERVICE_POLL_INTERVAL_SECONDS, 1s)`，默认等待序列为 `1s -> 2s`。只有响应为 2xx/206 且 `content-type` 是 `audio/*` 时，才直接写成 ready 的 `message_tts.remote_audio_url`，不调用 `POST /api/v1/tts`。如果接口 5 返回 404、非音频 2xx 或探测失败，则回到原 `submit_task + wait_for_reference` 链路，用当前问候正文生成对应语音。

## 7. MMD/VMD 资源链路

```text
Frontend model selector
  -> GET /assets/mmd/models
  -> FastAPI scans MMD_ROOT_DIR recursively for .pmx/.pmd
  -> returns model url
  -> MMDStage loads /assets/mmd/{file_path}
  -> textures resolved relative to model package
```

VMD/favorite motion：

```text
Upload VMD
  -> POST /assets/vmd
  -> asset_registry insert
  -> file stored under API data storage
  -> PATCH /assets/vmd/{asset_id}
       favorite=true
       model_relative_path=<selected model>
  -> Message Service resolves assistant action/motion_plan
       against favorite VMD list for selected model
       usage VMD auto-sync is serialized before SQLite asset_registry writes
```

当前优菈模型的收藏 VMD 已按动作意图存放在模型动作目录的子目录中：

```text
MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/
  00_idle_loop/              # 默认待机随机循环
  01_entry_fallback/         # 初始化、兜底姿态
  02_greeting_social/        # 打招呼、行礼、社交开场
  03_thinking_waiting/       # 思考、等待、超时
  04_answering_explain/      # 回答、介绍、解释、结论
  05_soft_emotion/           # 安抚、害羞、偷笑等轻情绪
  06_strong_personality/     # 炫耀、叉腰、轻蔑、暧昧等强语气
```

`/assets/mmd/vmds` 和 `/assets/vmd` 都支持递归扫描这些子目录。`asset_registry.favorite_relative_path` 需要保存完整分类路径；如果移动收藏 VMD 文件，必须同步更新 SQLite 中对应的 `favorite_relative_path`，并在 `relative_path` 或 `source_relative_path` 指向 `MMD_ROOT_DIR` 文件时同步更新这些字段。

VMD 收藏动作按 canonical 资产维护：同一用户、同一模型、同一分类、同一规范化动作名只保留一条 `asset_registry` 记录，磁盘上不保留 `name (2).vmd` 这类同名编号副本。新增或重新导入动作后，需要检查 `MMD_ROOT_DIR/usage/vmd/**` 和 `asset_registry`，避免编号副本重新进入前端待机池、点击动作池或 OpenClaw motion_key inventory。

给 OpenClaw 或其他 agent 选择 VMD 动作用的 motion_key、分类策略和当前优菈动作 inventory 维护在 `docs/architecture/openclaw-vmd-motion-selection-guide.md`。

前端舞台动作状态机：

```text
CompanionPage stageInteractionState
  -> stageInteractionMachine
     modes: default_idle / autoplay_loop / manual_preview / chat_vmd_action / chat_procedural_action / stage_click_vmd_action / stage_click_procedural_action / recovering
  -> MMDStage receives the current interaction only
  -> MMDCompanionRuntime executes procedural/VMD playback
  -> MMDStage reports complete/error back to CompanionPage
  -> CompanionPage returns to fresh favorite autoplay loop, or default procedural idle when no favorite loop exists
```

`stageInteractionMachine` 是页面业务状态层，负责把“`00_idle_loop` 待机循环、手动预览、聊天触发动作、人物点击触发动作、VMD 异常立即恢复、完成后回到待机”统一成显式状态。`MMDStage` 和 `MMDCompanionRuntime` 仍只负责加载模型、播放 VMD/程序动作、上报播放完成或错误，不持有业务队列或恢复策略。

语音播放向 `MMDStage` 传递 `speaking` 状态，同时 server/remote TTS 和 realtime voice chunk 会复用播客波形逻辑生成音频 envelope：前端用 `AudioContext.decodeAudioData()` 解码音频，再用 `computePeaks()` 得到幅度序列。播放时按 `audio.currentTime` 采样当前 level，并通过 `MMDStage.setSpeechLevel()` 传给 `MMDCompanionRuntime.updateMorph()` 驱动口型开合；停顿或低幅度会收嘴，音量越大开口越大。

中文口型同步在前端先走轻量 viseme 层：`speechViseme.js` 根据 TTS 文本把常见汉字映射到拼音，再按韵母生成 `A/I/U/E/O/M/sil` 时间轴；`b/p/m` 等双唇音会先给一个闭嘴 `M`，`ao/iao/uo` 等复合韵母会拆成连续嘴型。server/remote TTS 和 realtime voice chunk 在播放时通过 `createSpeechVisemeSync()` 按 `audio.currentTime` 调用 `MMDStage.setSpeechViseme()`，Runtime 优先按 viseme 驱动 `mouthA/mouthI/mouthU/mouthE/mouthO`，并继续用 envelope level 控制开口强度。若没有可用文本、文本无法识别、音频无法解码、跨域获取失败，或使用浏览器 `speechSynthesis`，Runtime 会回退到相对语音开始时间的慢周期嘴型，默认 520ms 一个开合周期、开口范围约 `0.18-0.60`，避免旧的绝对时间 `abs(sin)` 在约 150ms 内完成一次快速 flap。后续 Voice Workflow 若返回真实 viseme 时间戳，可直接替换前端文本推断出的时间轴。

渲染模式仍由前端 `renderPipeline` 隔离选择。`classic`、`hero-shot`、`genshin`、`mio-reference` 保持既有 Three.js/MMD runtime；新增 `reze-npr` 是 reze-engine 启发的实验模式，只迁移可在现有 Three.js 管线中低风险复刻的显示能力：按 PMX 材质名推断 face/body/hair/eye/stockings/metal/cloth 预设、对丝袜和 cutout 材质启用 Three.js `alphaHash`/`alphaToCoverage`、启用独立轮廓、ACES tone mapping、轻量 bloom 和 reze 风格灯光。它不接管 reze-engine 的 WebGPU renderer、PMX loader、VMD/IK/物理或 picking，因此不会改变现有模式的模型加载、VMD 播放和交互语义。`mio-reference` 当前默认开放镜头来自 2026-05-21 导出的 `Render Config`：`fov=32`、`position=[-9.39,12.522935,43.63]`、`target=[-1.861732,-2.847643,1.048369]`、`locked=false`，OrbitControls 的 `maxDistance` 仍为 72；页面启动时会把本地会话里的 `mio-reference` 镜头迁移到这组默认参数，避免旧 localStorage 覆盖默认构图。

`/mmd-calibration-render` 是给 `imgToAction` 和 Playwright 脚本使用的无外壳渲染入口。页面复用同一个 `MMDStage` / `MMDCompanionRuntime`，通过 query string 接收 `modelUrl`、`vmdUrl`、`renderPipeline` 和可选 camera snapshot；`imgToAction/tools/render-axis-calibration.mjs` 会启动本地静态文件服务，把校准 PMX/VMD 暴露给该页面，再调用 runtime 的 `setCalibrationCaptureMode(true)` 和 `seekVmdFrame(frame, fps)` 对 CSV 帧表中的 target/hold 帧逐帧截图。校准模式只在脚本捕获时启用：`seekVmdFrame` 直接采样当前 VMD `AnimationClip` 的骨骼 position/quaternion track 并写回 bone transform，而不是依赖 `AnimationMixer` 的非线性 seek；render frame 同时暂停 VMD 时间推进、跳过 MMD helper update、关闭待机 loop、呼吸骨骼偏移和口型/表情叠加，避免截图混入 companion runtime 的 procedural 覆盖；正常 `/companion` 页面仍按原有播放循环和交互状态运行。

`imgToAction` 的首版 landmark fitting 也复用同一个渲染入口。参考图人工关键点存放在 `imgToAction/config/reference_landmarks.eula_signature.json`；多角度图片批次可先通过可选的 `imgToAction/tools/extract_mediapipe_landmarks.py` 运行 MediaPipe Pose Landmarker IMAGE mode，生成 `imgToAction/config/reference_landmarks.eula_thinking.json` 和 `imgToAction/outputs/mediapipe/.../raw_mediapipe_landmarks.json`，其中低置信度 wrist/elbow/ankle/toe 点仍需要人工复核。`imgToAction/tools/export-model-landmarks.mjs` 会加载 PMX/VMD、seek 指定帧、把 reference config 中绑定的 PMX 骨骼投影为屏幕坐标；`imgToAction/tools/fit_pose_nodes.py` 用 neck/pelvis/ankle anchors 做 2D similarity alignment 后计算 weighted RMSE 和 worst landmark 列表，避免相机缩放/平移主导评分。`imgToAction/tools/run_landmark_fit_step.py` 是当前拟合 runner：它从 pose node DSL 生成一批语义参数候选 VMD，逐个通过 `/mmd-calibration-render` 导出骨骼投影，再写入 `outputs/fitting/.../candidate_step_*/fit_step_manifest.json`，用于选择下一轮 pose 参数调整。该链路只读主项目渲染 runtime，不改变 `/companion` 的用户动作播放状态。

`mio-reference` 的默认渲染也同步到该导出配置：renderer 使用 `toneMapping=none`、`exposure=1.57`，低环境光 `ambientIntensity=0.2`，暖色 hemisphere sky `#ff6929`，主光位于 `[-18.5,-25.6,64.3]` 且强度 1.43，地面阴影透明度 0.22。Bloom 和全身 outline 默认关闭但保留导出参数；材质调节在 Project2/Genshin 清理后应用，默认发色 tint 为 `#02c2f2`、强度 0.61，其它 face/skin/eye/cloth tint 也随 preset 保存。

MMD 相机状态只按渲染管线保存到 `session.mmdCamera[renderPipeline]`。VMD 预览、聊天动作、人物点击动作和待机 VMD 只改变 `stageInteractionMachine` 的动作播放状态，不再选择、应用或清空相机快照。`MMDStage` 收到明确的 camera snapshot 时才调用 runtime 应用相机；snapshot 为 null 时保留当前 runtime 视角，只有切换模型/渲染管线重建 runtime 或用户点击 Reset Camera 才回到当前 pipeline 默认相机。

`mio-reference` 保留一个可回滚的面部细节层 `faceDetails.chinLine`，但默认 `enabled=false`，因此当前不会画下巴描边。若后续需要继续试验，可重新设为 `true`；Runtime 会在模型加载、骨骼捕获之后把细 `TubeGeometry` 曲线挂到 head 骨骼，并在清理模型时随 `disposeFaceDetails()` 一起移除，不影响 VMD、材质调优、相机或全身 outline。

人物点击交互：

```text
Pointer down on MMDStage
  -> store pointer candidate only
Pointer up on MMDStage
  -> ignore long press and drag gestures
  -> MMDCompanionRuntime.hitTestModelAtClientPoint(clientX, clientY)
  -> only continue when raycast intersects the loaded MMD model
  -> CompanionPage creates a click ripple at the pointer position
  -> resolveStageCharacterClickInteraction()
     -> de-duplicate motions by category + normalized VMD name
     -> random single-shot VMD from 02_greeting_social / 05_soft_emotion / 06_strong_personality
     -> avoid immediately repeating the previous click motion when alternatives exist
     -> fallback safe favorite VMD excluding 00_idle_loop and 01_entry_fallback
     -> fallback procedural wave when no favorite VMD is available
  -> startStageClickInteraction()
  -> normal completion or VMD error returns immediately to 00_idle_loop/default idle
```

相关接口：

| Endpoint | 作用 |
| --- | --- |
| `GET /assets/mmd/models` | 扫描本地 MMD 模型 |
| `GET /assets/mmd/vmds` | 扫描本地 VMD 动作 |
| `GET /assets/mmd/validate` | 验证模型路径 |
| `GET /assets/mmd/{file_path}` | 提供模型和贴图文件 |
| `POST /assets/vmd` | 上传 VMD |
| `GET /assets/vmd` | 列出 VMD |
| `PATCH /assets/vmd/{asset_id}` | favorite/显示名/模型绑定 |
| `GET /assets/vmd/file/{asset_id}` | 提供 VMD 文件 |

## 8. 数据落点

| 数据 | 落点 |
| --- | --- |
| 用户、workspace、session | SQLite `accounts`, `workspaces`, `sessions` |
| `/companion` 与 `desktop-pet` 共享配置 | SQLite `companion_shared_config`：per-user `selected_model_path`、`render_pipeline`、`updated_at` |
| 聊天消息 | SQLite `messages` |
| TTS 状态 | SQLite `message_tts`, `tts_jobs` |
| OpenClaw Bridge | SQLite `message_bridge_bindings`, `message_bridge_state` |
| 动作解析结果 | SQLite `message_motion_resolution` |
| VMD 资产索引 | SQLite `asset_registry` |
| Motion context exports | SQLite `motion_context_exports` |
| Codex UI workspace 登记 | SQLite `codex_workspaces` |
| Codex session/turn/event/approval/artifact | SQLite `codex_interactive_sessions`, `codex_turns`, `codex_events`, `codex_approvals`, `codex_artifacts` |
| Codex Review Sync | SQLite `codex_openclaw_sync_outbox` 保存待提交/已提交 evidence pack；SQLite `codex_review_items` 保存 OpenClaw 返回的 draft work_summary/pitfall/decision/followup/blocker |
| desktop-pet Codex session registry | SQLite `desktop_pet_sessions`：metadata-only menu/resume registry，保存 `pet_session_id`、`codex_session_id`、workspace path、`CODEX_HOME` path、title/status/server metadata；prompt preview 和 summary 只保存 length-bounded 摘要字段。仅 Codex agent 写入该 registry；Claude agent 走纯本地 JSONL 链路，不 upsert 到该 registry |
| desktop-pet 本地设置 | Electron `userData/pet-settings.json`：当前选中的 workspace path、菜单语言、通知详情精度、置顶开关、当前 coding agent（`codex`/`claude`，默认 `codex`）、Pet window x/y；workspace 缺失时回退 `MMD_PET_WORKSPACE_PATH` 或 cwd 默认 workspace，window 恢复时始终固定为 360x420 |
| trace event | SQLite `trace_events` + NDJSON |
| chat mirror | SQLite `chat_mirror` |
| retry job | SQLite `retry_jobs` |
| 本地 PMX/PMD/贴图 | `MMD_ROOT_DIR` |
| 上传/存储的 VMD | `API_DATA_DIR` 下的 storage；收藏副本在 `MMD_ROOT_DIR/usage/vmd/{model}[动作]/`，可按动作意图继续分子目录 |

`companion_shared_config` 只保存 `/companion` 和 `desktop-pet` 共同需要的当前模型与渲染管线选择；不保存 pet camera、pet window position、notification profile 等 desktop-pet 专属状态。Pet camera 由 `desktop-pet` renderer 的 localStorage 独立维护，按 `selectedModel.relative_path + render_pipeline` 隔离，不写入 SQLite，也不复用主站 session 的 `mmdCamera`。Codex workspace 选择、菜单语言、通知详情精度、置顶开关和 Pet window 位置是 desktop-pet 本地设置，由 Electron 主进程 merge 写入 `userData/pet-settings.json` 的 `selectedWorkspacePath`、`menuLanguage`、`notificationProfile`、`alwaysOnTop` 和 `windowBounds`；workspace 路径只影响 Pet 的菜单扫描、VSCode 打开、新建 Codex 和默认恢复目标，不写入 SQLite 或 shared config。`desktop_pet_sessions` 只保存可读菜单、`codex resume` 和 review evidence 所需 metadata，不复制、不移动、不落库 Codex transcripts；`first_prompt_preview` 最多 240 chars，`last_summary` 最多 1000 chars，Codex session 持久化仍留在用户既有 `CODEX_HOME`。desktop-pet 主进程会按 `CODEX_HOME`（默认 `%USERPROFILE%\.codex` 或 `$HOME/.codex`）扫描 `sessions/**/rollout-*.jsonl`，只抽取 `session_meta.payload.id/cwd`、首条真实用户 prompt preview、尾部 assistant summary、尾部事件推断状态，以及 bounded review facts（failed command excerpt、changed file path、approval title、error excerpt、event counts）；扫描限制为当前 workspace 的最近候选文件，不读取全量大 transcript，也不会把完整 JSONL 内容写入 SQLite。当前 `desktop-pet` 是独立 Electron + Vite 子项目，dev 默认 renderer 为 `http://127.0.0.1:5174`；端口冲突时可用 `MMD_PET_DEV_PORT` 覆盖 Vite 端口，并用 `MMD_PET_RENDERER_URL` 指向 Electron dev renderer。`desktop-pet/start-pet.ps1` 是本地一键启动入口：在 `desktop-pet` 工作目录后台启动 `npm run dev` renderer，等待 renderer ready 后用同一 renderer URL 启动 Electron，并把日志写入 `.codex-pet/logs`；renderer helper 作为后台进程隐藏启动，但 Electron Pet GUI 不使用 `-WindowStyle Hidden`，避免 Windows 把交互式 BrowserWindow 也隐藏；如果已存在 `MMD Codex Pet` 窗口，默认会先停止当前 Electron 主进程再重新拉起，传 `-ReuseExisting` 才返回现有 PID，传 `-ForceNew` 才保留旧实例并额外新开。Pet BrowserWindow 的 `webPreferences.backgroundThrottling=false`，常驻窗口即使未聚焦也不会让 renderer 状态刷新和 MMD 动画进入后台节流。renderer 会读取 `/desktop-pet/shared-config`、`/assets/mmd/models` 和 `/assets/vmd`，复用 `web/src/features/stage/MMDStage` 在 transparent bare window 中渲染 MMD；当 shared config 为空时会跳过明显不可加载的 tiny placeholder PMX，选择第一个可加载模型作为 fallback。pet 待机 VMD 只使用当前模型绑定的 favorite VMD，并复用主站 `buildAutoFavoriteInteraction()` 规则：优先 `00_idle_loop` 中的 companion-safe 可播放动作，缺失时回退排除 entry standby 的安全 favorite 池，再缺失才回到 procedural idle；传给 desktop runtime 前会把 lead `vmdUrl`、循环 URL、standby URL 和 emotion map key 转成 API 绝对地址。renderer 用 `buildPetAutoplayIdleState()` 把该结果包装成 `source="autoplay"` 的 stage state；启动、主站同步 remount、点击动作完成或失败后的恢复都回到这份状态，避免首屏停在 procedural idle。

Electron 原生右键菜单当前由主进程构建，API 地址来自 `MMD_PET_API_BASE_URL`（默认 `http://127.0.0.1:8000`），菜单查询身份来自 `MMD_PET_USER_ID`（默认 `admin-1`）。菜单打开时会先用内存缓存和当前 workspace 的本地 Codex JSONL 构建 native menu 并立即 `Menu.popup`；`POST /desktop-pet/sessions` upsert 与 `GET /desktop-pet/sessions?limit=10` 刷新在 popup 后异步执行，避免 API 慢或 500 时阻塞右键菜单。API 不可用时菜单仍使用本地扫描结果作为 fallback。菜单显示标签压缩成 title / time / status 组合，避免在菜单里暴露 UUID-heavy 字符串。当前菜单项包括 `Workspace` / `工作区`（显示当前 workspace，并可通过 `Select Workspace...` / `选择工作区...` 打开系统目录选择器）、`New Codex Session`、`Send Prompt...` / `发送 Prompt...`、`Recent Sessions`、`More Sessions...`、`Interaction Mode`、`Notification Detail`、`Language / 语言`、`Coding Agent` / `编程助手`、`Always on Top` / `固定在顶部`、`Open VSCode Workspace` / `打开 VSCode 工作区`、`Sync from Main Site` / `从主站同步` 和 `Close`；主进程会把带 `submenu` 的模型项转换成 Electron native `type="submenu"`，因此 `Workspace`、`Interaction Mode`、`Notification Detail`、`Language / 语言` 和 `Coding Agent` 在 Windows 原生菜单中以可展开子菜单呈现。其中 `Interaction Mode` 的 `Drag Whole App` / `Adjust Camera` 会立即生效：preload 以 CommonJS `preload.cjs` 加载并暴露 `window.desktopPet`，renderer 始终把 shell、stage 和 WebGL canvas 保持为 `-webkit-app-region: no-drag`，确保透明 frameless window 仍能收到 DOM `contextmenu`；由于 Windows transparent layered window 的全透明像素可能鼠标穿透，pet 会在 WebGL 上方绘制一个真实 DOM 覆盖层 `.pet-input-hit-surface`（`rgba(255,255,255,0.035)`），保证整窗区域有可命中的合成像素。Pet BrowserWindow 固定为 360x420，`resizable=false` 且 min/max 尺寸锁定；整窗拖动优先由 renderer 在 `Drag Whole App` 模式以 document capture listener 捕获左键 pointer，并通过 `pet:window-drag:start|move|end` IPC 让主进程按系统 cursor delta 调整 BrowserWindow bounds，移动时始终保留 drag 起点的 width/height。主进程同时在 Windows 下用 `hookWindowMessage` 监听 `WM_RBUTTONUP`、`WM_LBUTTONDOWN`、`WM_MOUSEMOVE` 和 `WM_LBUTTONUP` 作为透明 WebGL 子窗口不分发 DOM 鼠标事件时的兜底路径；同一次拖动中第一条到达的 IPC/native source 持有 drag 状态，后到 source 不会覆盖 origin bounds，非持有 source 的 move 会被忽略，任一 end 信号都可释放 drag 状态，避免重复事件把拖动变成系统 resize 或把异常尺寸写回。右键菜单优先走 renderer document capture `contextmenu -> pet:menu:open-context({x,y})`，主进程的 `system-context-menu` / `webContents context-menu` / native mouse hook 监听保留为 fallback；renderer/webContents 提供的是窗口内坐标，native/system hook 提供的是屏幕坐标。主进程会把两类输入统一解析成两份坐标：`Menu.popup({ window, x, y })` 使用 clamp 到 Pet window bounds 的窗口内 popup 坐标，避免屏幕坐标被当成窗口 offset 造成菜单远离 Pet；右键去重使用对应屏幕坐标。native/system screen 坐标如果不在当前 Pet BrowserWindow bounds 内，会被直接丢弃，不会 clamp 到窗口边缘打开菜单，并且会记录为一次 native/system 右键触发以压掉随后迟到的 renderer/webcontents fallback，避免 Windows hook 的窗口外 `WM_RBUTTONUP` 造成桌面其他区域也弹 Pet 菜单。主进程对同一次右键做 source-aware 去重：350ms 内所有 popup 请求直接丢弃，1500ms 内同屏幕坐标（4px 容差）的重复请求会丢弃；如果 native popup 已打开或 native/system 外部右键刚被忽略，随后 1500ms 内迟到的 renderer/webcontents fallback 也会丢弃，即使 renderer 坐标失真，避免第二个菜单出现在窗口左上角。去重不依赖 menu close callback 维持右键可用性。切到相机调整时 renderer 停止发送窗口拖动 IPC，native mouse hook 也不会启动窗口拖动；renderer 向 `MMDStage` 传 `cameraLocked=false` 并关闭 bare stage 的角色点击 pointer capture，让 OrbitControls 在 WebGL canvas 上接管 zoom/pan/rotate；切回拖动整窗时重新锁住 camera 并恢复角色点击捕获。需要诊断真实右键/拖动事件时，可用 `MMD_PET_DEBUG_EVENTS=1` 开启主进程 NDJSON 事件日志，默认写入当前工作目录 `desktop-pet-debug-events.ndjson`，也可用 `MMD_PET_DEBUG_EVENTS_LOG` 指定路径；默认不开启。`Notification Detail` 和 `Language / 语言` 由主进程写入 Electron `userData/pet-settings.json`，下次启动会先从 settings 初始化菜单语言和勾选态；语言切换只影响 desktop-pet 右键菜单标签，不切换主站语言，也不写入 SQLite。Pet window bounds 在 drag end 和 close 时保存，恢复时只采用 x/y，width/height 总是归一为固定 360x420。主站 `/companion` 高级面板提供显式 `保存到桌面 Pet` 按钮，用当前模型和渲染管线写入 shared config；pet 右键 `Sync from Main Site` / `从主站同步` 会让 renderer 重新读取模型、动作和 shared-config，成功后显示同步到的模型名与 render pipeline，并递增 stage reload revision 以强制 MMDStage remount 一次。`New Codex Session` 由主进程执行系统启动动作：目标 workspace 优先使用右键 `Workspace -> Select Workspace...` 持久化的 `selectedWorkspacePath`；缺失时才回退 `MMD_PET_WORKSPACE_PATH`，再回退 Electron 当前工作目录（若当前工作目录是 `desktop-pet`，则自动上提到父级项目根目录）。主进程先在目标 workspace 写入 `.codex-pet/vscode-terminal-request.json` 和 `<os.tmpdir()>/mmd-codex-pet/vscode-terminal-request.json`，其中包含 `codex` 或 `codex resume --cd <workspace> <codex_session_id>` 命令，再按 `MMD_PET_VSCODE_HELPER_MODE` 打开 VSCode：默认或未知值为 `development`，使用 `MMD_PET_VSCODE_CLI`（默认 `code`）执行 `code --new-window --user-data-dir <os.tmpdir()/mmd-pet-vscode-ud/...> --extensionDevelopmentPath <desktop-pet/vscode-helper> <workspace>`，确保新窗口加载 helper 并处理 terminal request；`installed` 模式执行 `code --new-window --user-data-dir <os.tmpdir()/mmd-pet-vscode-ud/...> <workspace>`，要求 helper extension 已通过 `desktop-pet/scripts/install-vscode-helper.ps1` 或等效方式安装并启用。Windows shell 启动时会显式 quote VSCode CLI、helper 路径、user-data-dir 和 workspace 路径，确保 `D:\workspace\MMD project` 这类含空格路径不会被拆成 open editors。`MMD_PET_VSCODE_HELPER_EXTENSION_PATH` 可覆盖 development helper extension 路径。VSCode helper 扩展启动后读取该 request，创建或复用 VSCode 内置终端 `Codex Pet`，并在该终端执行 `MMD_PET_CODEX_CLI`（默认 `codex`）或 resume 命令；执行成功后 helper 会删除 request 文件，超过 5 分钟的旧 request 会被忽略并清理，避免后续打开 workspace 时误启动 Codex。Pet 不再启动外部 `cmd.exe`。`Send Prompt...` / `发送 Prompt...` 先在 renderer 打开 `.pet-panel` prompt 面板，preload 通过 `pet:prompt:send` 调主进程；当前优先走 app-server relay，relay 不可用时把 prompt 暴露为状态卡上的 copyable command，不直接写 terminal request。启动后主进程仍会短轮询当前选中 workspace 的本地 JSONL，把新 session metadata 同步到 registry。`Recent Sessions` 子菜单现在会缓存最近 session；点击任一项会打开该 session 记录的 VSCode workspace，并通过同一 helper request 在 VSCode 内置终端执行 `codex resume --cd <workspace> <codex_session_id>`，因此 Codex 原有 `CODEX_HOME` session 存储保持不变，CLI 可正常 resume 会话。主进程会同步维护 `pet:codex-status`：启动前发布 `starting`，成功拉起 terminal request 后发布 `launched`，恢复时发布 `resuming`/`running`，发送 prompt 成功后发布 `running`，本地 JSONL 推断状态会发布 `running`、`command_running`、`waiting_approval`、`completed`、`failed` 或 `disconnected`，失败时发布 `failed` 和错误信息；每次 `pet:codex-status:changed` IPC 发送后都会调用 `webContents.invalidate()` 调度 transparent Pet 窗口重绘，避免未聚焦窗口的状态卡等到 focus/hover 才刷新。preload 暴露 `codexStatus.get/onChanged` 给 renderer，pet 状态条会把该状态作为常驻状态显示（短暂菜单 toast 结束后仍保留，例如 `Codex running · <session title>`）。`Open VSCode Workspace` 和 renderer 审批 fallback 按钮都通过当前选中 workspace 打开新的 VSCode window；focus 成功只在 renderer 里短暂显示 `VSCode workspace open` toast，不发布新的 Codex 状态，也不覆盖当前 running/output/approval 状态。`More Sessions...` 点击后主进程会拉取最多 50 条 session（API registry 加当前 workspace 本地 JSONL fallback），通过 `pet:menu:action` 发送给 renderer，renderer 在 Pet 窗口内显示可搜索 session 面板，按 title/workspace/status/time 生成搜索文本并展示可读 title、workspace、状态和最近时间；点击面板中的 active session 会调用 `pet:sessions:focus-active` IPC，主进程先用内存映射或 `<user-data-dir>/.codex-pet/session-window.json` marker 按 session id 找回已有 VSCode 窗口；marker 缺失时会扫描 VSCode `User/workspaceStorage/*/workspace.json` 做一次性 workspace 兜底，以已有 `user-data-dir` 调 `focusVscodeWorkspace`，不写入精确 session marker；非 active session 才调用 `pet:sessions:restore` IPC，复用 `restore-session` 分支在 VSCode 内置终端执行 `codex resume --cd <workspace> <codex_session_id>`。

Pet window bounds 启动恢复会按当前 Electron `screen.getAllDisplays().workArea` 校验。保存坐标仍有至少 80px 可见边时继续使用原坐标；如果 RDP、多屏切换、DPI 变化或断开副屏导致保存坐标不在任何当前显示器工作区内，主进程会把 360x420 Pet 窗口回退到主显示器工作区居中，并写入 `window-bounds:restored-to-visible-area` debug event，避免窗口只出现在任务栏缩略图而桌面不可见。

右键 `Workspace` / `工作区` 子菜单会基于当前菜单可见的 session 集合额外聚合 `Active Workspaces` / `活跃工作区`：来源包括主进程内存缓存、当前选中 workspace 的本地 JSONL 扫描结果，以及 API registry 成功刷新后的 recent sessions。聚合只统计 `starting`、`running`、`command_running`、`file_changed`、`waiting_approval` 这类仍活跃状态，排除 `completed`、`failed`、`disconnected`。`Active Workspaces` 先按 workspace 分组，每个 workspace 以目录 basename、最近活跃状态和活跃任务数显示为二级子菜单；展开后列出该 workspace 下按最近更新时间排序的活跃任务，点击任务项发送 `focus-active-session`，主进程使用运行时内存映射或 `<user-data-dir>/.codex-pet/session-window.json` marker 按 session id 找回 VSCode `user-data-dir`，再调 `focusVscodeWorkspace({ workspacePath, userDataDir })`，只聚焦该任务已有窗口，不执行 `codex resume` / `claude --resume`。new/restore 启动 VSCode 时会先写 workspace 级 marker，JSONL watcher 识别出真实 session id 后会补写 session 级 marker；Pet 重启后仍可按 marker 聚焦对应任务。若 marker 缺失，主进程会扫描 VSCode `User/workspaceStorage/*/workspace.json` 做一次性 workspace 兜底，但不会把该猜测写成 session marker；完全找不到时才发布 failed 状态提示窗口元数据不可用，仍不退回 restore，以避免同一工作区重复开新 VSCode window。当前选中的 workspace 在分组内显示为已勾选的 `Current workspace`，其他 workspace 分组内提供 `Switch to workspace`，点击后写入 Electron `userData/pet-settings.json` 的 `selectedWorkspacePath`、发布 idle `pet:codex-status`、清空当前菜单 session cache 并后台刷新该 workspace 的 sessions。该切换只影响 desktop-pet 的后续菜单扫描、新建/恢复/打开 VSCode 目标，不写入 SQLite 或主站 shared config。

当前实现准则：`MMD_PET_VSCODE_HELPER_MODE=installed` 不传 `--extensionDevelopmentPath`；新建/恢复 Codex terminal request 使用 `code --new-window --user-data-dir <os.tmpdir()/mmd-pet-vscode-ud/...> <workspace>` 打开目标 workspace 的新 VSCode 窗口，默认 development helper 模式还会额外传 `--extensionDevelopmentPath <desktop-pet/vscode-helper>`，确保新窗口内 helper 能读取 request 并在 `Codex Pet` integrated terminal 执行 `codex` 或 `codex resume --cd <workspace> <session_id>`。Pet prompt fallback 当前不写 terminal request，而是把 prompt 显示成状态卡上的 copyable command。Pet 主进程为 new/restore 写入两份同 payload 的 request：workspace-local 主文件 `<workspace>/.codex-pet/vscode-terminal-request.json`，以及用户临时目录指针 `<os.tmpdir()>/mmd-codex-pet/vscode-terminal-request.json`。VSCode helper 会同时扫描 workspace folders 和临时指针；这是为了覆盖 VSCode development host 已加载 helper 但 `workspaceFolders=[]` 的情况。helper 成功发送 terminal text 或判定 request stale 后会删除两份文件，并在 VSCode output channel `MMD Codex Pet Helper` 记录 activation、workspace folder 可见性和 request id。Pet 主进程会在写入 terminal request 后检查同一 request id 是否被 helper 消费；若 workspace-local request 文件仍残留，会记录 `codex-launch:terminal-request-unhandled` 并把 `pet:codex-status` 标记为 `failed`，提示检查 VSCode 目标窗口和 helper 安装/加载状态。

补充：VSCode window 拉起路径统一规避 VSCode 的同 workspace 去重。`New Codex Session`、恢复 session、右键 `Open VSCode Workspace`、状态卡点击和审批 fallback 的 `pet:vscode:focus` 都通过 `code --new-window --user-data-dir <os.tmpdir()/mmd-pet-vscode-ud/...> <workspace>` 打开目标 workspace；每次调用都会生成新的临时 user-data-dir，避免同一个 workspace 第二次只复用或聚焦已有窗口而无法重复拉起。其中 new/restore 会先写 terminal request 并加载/依赖 helper 自动执行 Codex integrated terminal 命令；纯 focus 路径只打开 workspace，不启动新的 Codex 命令。该临时目录由 desktop-pet 启动时的 stale cleanup 做最佳努力清理，focus 成功仍只显示 renderer toast，不覆盖当前 `pet:codex-status`。

补充：terminal 新建/恢复/fallback prompt 不再只依赖固定 1.5s/5s/12s 短轮询；主进程会启动一个有上限的 JSONL watcher 持续刷新当前 workspace/session 的 `last_output`，让 VSCode 内置终端里启动的 Codex 输出能进入 Pet 状态卡。

当前实现中，上述 `Send Prompt...` 的 terminal `mode=prompt` 路径只作为 app-server relay 失败后的 fallback；正常情况下 Pet prompt 会优先走 `/codex/interactive/sessions` + websocket relay，审批按钮也只有 relay 状态携带 approval id 时才直接显示。

Coding Agent 切换：desktop-pet 右键菜单新增 `Coding Agent` / `编程助手` 子菜单，可在 `Codex` 与 `Claude`（Claude Code）之间切换当前编程助手，选择持久化到 `userData/pet-settings.json` 的 `agent` 字段（默认 `codex`，启动时读取）。切换是新建/恢复/发 prompt/会话扫描/状态卡文案的统一分派维度，菜单 `New {agent} Session` 标签和状态卡前缀（`Claude running …` / `Codex running …`）都随当前 agent 变化。两个 agent 复用同一套 VSCode 终端启动机制（同一 `.codex-pet/vscode-terminal-request.json` 请求文件 + 全局临时指针 + helper），仅终端名区分：Codex 用 `Codex Pet` 终端、Claude 用 `Claude Pet` 终端，互不串扰；命令行不同——Codex 为 `codex` / `codex resume --cd <workspace> <id>`，Claude 为 `claude` / `claude --resume <id>`（Claude CLI 无 `--cd`，靠终端 cwd 锁定 workspace，由 helper 用 `request.workspacePath` 作为终端 cwd 保证）。Claude CLI 可用 `MMD_PET_CLAUDE_CLI` 覆盖（默认 `claude`）。Claude 会话扫描读取 `CLAUDE_CONFIG_DIR`（默认 `%USERPROFILE%/.claude` 或 `$HOME/.claude`）下的 `projects/**/<session-id>.jsonl`，按每行 `cwd` 字段过滤当前 workspace（不依赖目录名编码），抽取首条真实用户 prompt、尾部 assistant 文本、tool_use/tool_result 推断的 bounded review facts 与状态；可推断 `running`/`command_running`（Bash 系工具）/`file_changed`（Edit/Write/MultiEdit/NotebookEdit）/`completed`（`stop_reason=end_turn`），但 Claude 的审批是交互式 UI、不落 JSONL，因此 Claude agent 下不会出现 `waiting_approval` 状态、也没有 approval id。Claude 是纯本地链路：不调用 FastAPI `/codex/interactive/*` relay，也不把会话 upsert 到 `desktop_pet_sessions` registry；app-server relay 与 approval 直显仅在 Codex agent 且 API 可用时启用。`desktop_pet_sessions` SQLite registry 仍只承载 Codex；Claude session 持久化保持在用户既有 `CLAUDE_CONFIG_DIR`，Pet 不复制、不移动、不落库 Claude transcripts。

More Sessions renderer 面板当前在每条 session row 内显示 title、workspace、status、最近时间、首条 prompt preview 和最近 summary preview。`desktop-pet/src/codex/sessionPicker.ts` 会把 prompt/summary 压缩成单行、做长度截断，并对明显 `token`、`password`、`secret`、`key`/`api_key` 等 `key=value` 或 `key: value` 形式替换为 `[redacted]`；搜索索引使用脱敏后的 title/workspace/status/time/prompt/summary，避免面板搜索文本保留原始 secret。picker 同时按 `starting`、`running`、`command_running`、`file_changed`、`waiting_approval` 标记 `isActive`：active row 点击调用 `pet:sessions:focus-active`，复用主进程内存映射、session-window marker 或 workspaceStorage 兜底聚焦任务窗口；非 active row 继续调用 `pet:sessions:restore` 恢复历史会话。面板沿用 `.pet-panel` pointer 保护和 row 级 `-webkit-app-region: no-drag`，不触发整窗拖动。

desktop-pet 右键菜单还有一个 active 生命周期保护：主进程从准备 `Menu.popup` 到 native menu close callback 结束期间设置 `contextMenuActive`，此时任何 native、renderer、system 或 webcontents 来源的新 popup 请求都会被 dedupe，避免连续右键重入 Electron native menu。`desktop-pet/scripts/stress-pet-right-click.ps1` 使用真实 Windows 输入循环验证菜单 open/popup/closed 计数、`context-menu:error` 数量和 Electron 进程存活；脚本默认拒绝控制真实鼠标，必须显式传 `-AllowMouseControl`，并在退出或失败时释放鼠标按钮、恢复鼠标位置和 Pet 窗口位置。脚本关闭菜单时只向 Pet BrowserWindow owner hwnd 投递 `WM_CANCELMODE`/targeted Escape window message，不使用全局 `keybd_event`，避免把 `Esc` 发送到用户当前命令行或 Codex 终端。该脚本还提供 `-EdgePlacement Right|Bottom|BottomRight`，可把 Pet 移到当前显示器工作区边缘后执行短烟测或压力测，并断言右键后窗口漂移不超过 `MaxWindowDriftPx`、尺寸不变、菜单 popup/closed 数量满足 sequential click 数量且没有 error 事件；`desktop-pet/scripts/desktop-pet-manual-acceptance.md` 固定记录启动、右键、拖动、相机、同步、Codex 新建/恢复的真实桌面验收步骤。Pet 相机状态不走共享配置 API；renderer 在从 `Adjust Camera` 切回 `Drag Whole App` 时 capture 当前 `MMDStage` camera snapshot，归一成 drag-mode 初始化用的 locked snapshot，并按 `selectedModel.relative_path + render_pipeline` 写入 localStorage。后续同一模型和 render pipeline 的 Pet 初始化、同步后 remount 或应用重启会把该 snapshot 传给 `MMDStage.cameraSnapshot`；不同模型或管线不会复用该镜头。Pet 角色点击动作复用主站 `resolveStageCharacterClickInteraction()`：在 `Drag Whole App` 模式下，renderer 顶层透明 hit surface 记录 pointer click，再通过 `MMDStage.hitTestCharacterAtClientPoint()` 确认是否点中角色；命中后优先播放 greeting/soft/strong click reaction favorite VMD，并在有其他可用动作时避开上一条 click VMD，缺失 VMD 时回退 procedural wave。点击动作完成或失败后，Pet 清空 click override，回到当前模型的 idle/autoplay loop；`Adjust Camera` 模式仍关闭角色点击捕获，让 OrbitControls 接管鼠标。

desktop-pet 当前有两类 Codex 状态源。VSCode terminal 新建/恢复流程仍保留用户既有 `CODEX_HOME` session 存储：主进程在 Pet renderer 每次 `did-finish-load` 后、右键菜单打开、`More Sessions...` 打开，以及 terminal 新建/恢复/fallback prompt 后扫描当前 workspace 的 `CODEX_HOME/sessions/**/rollout-*.jsonl`，只读取 head/tail 窗口并抽取 bounded metadata。这样状态卡在 Pet 窗口首次显示时就会同步最近 session/output，不再依赖“先打开一次右键菜单”才看到最新内容。terminal 路径启动后会开启 `codex-session` JSONL watcher：先立即扫描一次，随后约每 2.5s 刷新一次，最长保留 1 小时；新 watcher 会替换同一 Pet 窗口上的旧 watcher，窗口关闭时停止，扫描到 `failed` 或 `disconnected` 会提前停止，`completed` 仍继续观察以便同一 VSCode terminal 后续继续输入时能更新输出。JSONL 状态精度受 Codex CLI 写入时机和 Pet 扫描节奏限制：该源可推断 `running`、`command_running`、`file_changed`、`waiting_approval`、`completed`、`failed` 和 `disconnected`，但没有 approval id 或实时 token stream。Pet 内直接 `Send Prompt...` 在 API 可用且 `MMD_PET_CODEX_RELAY_ENABLED` 未显式设为 `0/false/off/no` 时优先使用 app-server relay：Electron 主进程通过 `CodexInteractiveRelayClient` 登记当前 git workspace、创建 `/codex/interactive/sessions` session（默认 `MMD_PET_CODEX_RELAY_MODE=patch`，可设为 `read_only`）、打开 `/ws/codex/interactive/{session_id}`，发送 `{ type: "user_message", text, mode }`，并把 websocket 事件实时折叠为 `pet:codex-status`。relay 状态源可提供 `approval_required` 的 approval id、审批 title/detail、`text_delta`/`command_output`/`turn_completed` 的最近输出；renderer 因此可以显示 direct `Approve`/`Deny`，并通过 `pet:approval:decide` 调 `POST /codex/interactive/{session_id}/approvals/{approval_id}`。如果 API 不可用、workspace 登记失败、session capacity 限制或 websocket 连接失败，主进程记录 `codex-relay:send-prompt-fallback`，再回退到 VSCode terminal prompt request；该回退仍只向当前 `Codex Pet` 内置终端 `sendText(prompt, true)`，不具备协议级 approval id。

renderer 侧 Codex 状态纯函数把 scanner/relay 状态映射为 `motionIntent`、`statusTone` 和 `shouldInterruptIdle`：`running -> thinking/active`、`command_running -> command/active`、`file_changed -> file_change/attention`、`waiting_approval -> approval/attention`、`completed -> complete/success`、`failed -> failure/danger`、`disconnected -> disconnected/offline`。MMD stage 纯函数再把这些 intent 转为 procedural status interaction；如果当前 click reaction 仍 active，Codex status motion 返回 `click-interaction` 优先级和 blocked reason，不覆盖点击动作。App 在把 Codex status interaction 传给 `MMDStage` 前会先做可播放命中解析：VMD interaction 必须有 runtime 可直接播放的 `vmdUrl`，procedural interaction 必须命中 runtime 支持的 action 或 sequence step；未命中时直接使用当前模型的 `petAutoplayIdleState.interaction`，优先进入 favorite idle/autoplay VMD loop。如果兜底本身也没有可播放 VMD，App 返回 null 并保留当前 stage interaction，不再应用 procedural idle 去触发 runtime 重置，避免停在 base pose。因为 procedural status action 播完后 runtime 会清空当前 action，Pet 对 `starting`、`launched`、`resuming`、`running`、`command_running`、`file_changed`、`waiting_approval` 和 `disconnected` 这类活跃状态会在 completion 回调中递增 replay revision，重新 apply 同一个 Codex status interaction，避免执行中状态只播一个周期后长期回到待机；`completed` 和 `failed` 仍按一次性提示处理，播完后可恢复待机。`Notification Detail` 的 renderer 策略为 low/medium/high：low 只给短状态并省略 workspace/path/session id；medium 给可读 session title、workspace basename 或错误信息，仍不暴露完整 path/id；high 用于诊断，可包含完整 workspace path、Codex session id 和 updatedAt。`waiting_approval` 分两种处理：`source="app-server-relay"` 且状态包含 `pendingApprovals[].id` 时，状态条显示 direct `Approve`/`Deny` 按钮；本地 JSONL scanner 没有 approval id 时仍只显示 fallback message 和 `Open VSCode`，引导用户在 VSCode Codex terminal 内审批。

desktop-pet Electron API runtime helper 位于 `desktop-pet/electron/apiRuntime.ts`，用于主进程统一集成 API 可用性判断和可选自启动。主进程创建 Pet window 后会后台调用 `ensureApiRuntime()`，把最近一次结构化结果保存到 `currentApiRuntimeStatus`，用 `pet:api-runtime:changed` 发送给 renderer，并记录 `api-runtime:status` 或 `api-runtime:error` debug event；该状态不会阻塞 Pet 窗口启动。`runtimeInfo()` 同时返回 `apiBaseUrl` 和最近 runtime status；preload 还暴露 `apiRuntime.get()`、`apiRuntime.retry()` 和 `apiRuntime.onChanged()`。renderer 首次 API 加载失败时显示 `API unavailable` 和 `Retry` 按钮；用户点击 Retry 会让主进程重新 probe/autostart，若后续 status 变为 available，renderer 会自动重新读取 shared config、模型和 VMD 资产。helper 默认检查 `MMD_PET_API_BASE_URL`（缺省 `http://127.0.0.1:8000`）的 `/healthz`；fetch 失败或非 2xx 会返回结构化 `state="unavailable"`、health URL、失败原因、attempts、checkedAt 和 autostart 状态，让菜单/session 流程继续走本地 JSONL fallback。默认不启动 API；只有 `MMD_PET_API_AUTOSTART=1` 且 `MMD_PET_API_START_COMMAND` 非空时，helper 才会以 hidden detached background process 执行该命令，stdout/stderr 写入 `MMD_PET_API_LOG_DIR` 或 `<cwd>/.codex-pet/api-runtime/` 下的 `api-runtime.out.log` / `api-runtime.err.log`，随后按 retry 配置重新 probe `/healthz`。启动命令作为单条 shell command 传给 `spawn(command, [], { shell: true, windowsHide: true })`，因此 Windows 上包含空格的脚本路径应由 env 值自身加引号，例如 `"D:\workspace\MMD project\scripts\start api.ps1" --port 8000`。

`desktop-pet/start-pet.ps1` 未显式传 `-ApiBaseUrl` 且当前 shell 未设置 `MMD_PET_API_BASE_URL` 时，会读取项目根目录 `.runtime/dev-stack.json` 中的 `api.url`，并先验证该 URL 的 `/healthz` 可访问；验证通过后脚本会把该 URL 注入 Electron 进程的 `MMD_PET_API_BASE_URL`。因此 dev-stack 改用 8100 等非 8000 端口时，Pet 通过该脚本启动会自动连接当前运行的 API；只有 dev-stack state 不存在、解析失败或 health check 不通时才回退 `http://127.0.0.1:8000`。

desktop-pet 启动时会在 Electron main 进程尽早安装 crash diagnostics。`crashReporter.start({ uploadToServer: false })` 会收集后续 renderer、GPU/utility 等子进程 crash dump，dump 目录默认是 `desktop-pet/.codex-pet/crash-dumps`，可用 `MMD_PET_CRASH_DUMPS_DIR` 覆盖；结构化事件默认写入 `desktop-pet/.codex-pet/logs/crash-events.ndjson`，可用 `MMD_PET_CRASH_EVENTS_LOG` 覆盖。该 NDJSON 不依赖 `MMD_PET_DEBUG_EVENTS`，会记录 `crash-reporter:started`、`renderer:gone`、`child-process:gone`、main process `uncaughtExceptionMonitor`、`unhandledRejection`、Node warning，以及 preload 转发的 renderer `error` / `unhandledrejection`。真正的 native main-process 崩溃仍可能只能留下 Electron crash dump 或 Windows Error Reporting 记录；renderer/GPU 崩溃会优先通过 Electron gone events 写入 reason、exitCode、webContents id 和 URL。

desktop-pet 右键菜单提供 `Always on Top` / `固定在顶部` checkbox，用于切换当前 Pet BrowserWindow 是否保持置顶。启动默认仍为置顶开启，但会被 Electron `userData/pet-settings.json` 中的 `alwaysOnTop` 覆盖；用户点击后主进程 merge 写回该设置，调用 `BrowserWindow.setAlwaysOnTop(true, "floating")` 或 `BrowserWindow.setAlwaysOnTop(false)` 立即生效，并把动作发送给 renderer 显示短暂状态提示。该状态不写入 SQLite、shared config 或 renderer localStorage。

共享配置 API 合约：

Codex 状态卡补充：desktop-pet 的本地 JSONL scanner 除了 session title/status，也会提取最近一条 assistant 文本或 `function_call_output`，通过 registry payload 的 `metadata.last_output` 进入 renderer；app-server relay 则直接从 websocket `text_delta`、`command_output`、`approval_required`、`turn_completed` 等事件折叠最近输出。renderer 的常驻 Codex 状态卡用状态灯表达 `active/attention/success/danger/offline` 状态，文字标题只保留给无障碍文本和 tooltip；当 MMD 模型已加载且没有 active Codex 状态、加载错误或菜单 toast 时，renderer 仍显示 `Codex idle` / `No active Codex output` 占位状态卡，避免桌面 Pet 只剩角色而看不到消息框；完成态会在角色右上角显示独立完成气泡，气泡标题展示完成的 workspace basename，正文可展示 session/task title，主体点击调用 `pet:vscode:focus({ workspacePath })` 打开对应 workspace，新完成事件按 session id 或 workspace/task/output 生成稳定 key，用户点击 `x` 手动关闭后同一完成事件不再重复弹出。输出区域固定为更宽的三行自动换行预览，并在展示前过滤 `Exit code:`、`Wall time:`、`Total output lines:` 这类工具运行元信息，再脱敏 token/password/secret/key/API key 形式的敏感片段；JSONL 源仍不是实时 token stream 或完整 transcript，relay 源也只展示 bounded preview 而非完整 transcript。状态卡点击会把 status 自带的 `workspacePath` 传给 `pet:vscode:focus({ workspacePath })`，因此可以打开对应 session/workspace 的新 VSCode window，而不是只打开当前菜单选中的 workspace；该 focus IPC 成功时不改变 `pet:codex-status`，只让 renderer 的 transient toast 自动清理后回到原 Codex 状态卡。Pet 的角色点击命中和动作选择继续复用主站 `stageCharacterClick` helper：renderer 用共享 `shouldTriggerStageCharacterClick()` 判断 click 手势和共享 `createStageClickRipple()` 生成波纹，Pet stage state 用共享 `resolveStageCharacterClickInteraction()` 选择 click reaction VMD，后续维护只改这一份主站 helper。

- `GET /desktop-pet/shared-config`：按 `x-user-id` requester identity 返回该 user 的共享 companion config。
- `PUT /desktop-pet/shared-config`：按 `x-user-id` requester identity 写入共享配置；body 字段为 `selected_model_path: string | null`（max 1000）与 `render_pipeline: "classic" | "hero-shot" | "genshin" | "mio-reference" | "reze-npr"`（default `classic`）。
- 无效 `render_pipeline` 会被拒绝并返回 `422`。

desktop-pet session registry API 合约：

- 所有 session registry routes 都要求 `x-user-id` requester identity；缺失会返回 `401`。
- `GET /desktop-pet/sessions?limit=N`：返回最近 desktop-pet Codex session registry rows，response shape 为 `{ sessions, limit }`；`limit` 会限制在 `1..50`。
- `POST /desktop-pet/sessions`：upsert 一条 registry metadata row，保存 pet/Codex session id、workspace path、`CODEX_HOME`、display title、status/server metadata、bounded prompt preview/summary；旧版 payload 若未带 `workspace_id`，FastAPI 会写入当前 `CODEX_OPENCLAW_CONTROL_PLANE_WORKSPACE_ID`，让后续 Codex review snapshot 能按 workspace 汇总；key payload limits 为 `display_title <= 48`、`first_prompt_preview <= 240`、`last_summary <= 1000`，`metadata` 保持 JSON object，但 serialized JSON 超过 30000 chars 会返回 `422`。
- `DELETE /desktop-pet/sessions/{pet_session_id}`：删除指定 pet registry row，response shape 为 `{ deleted }`，只影响 `desktop_pet_sessions` registry metadata。
- 这些接口不读取、不复制、不移动、不落库 Codex transcripts；`codex resume` 仍使用用户既有 `CODEX_HOME` 中的 Codex session 持久化。

## 9. 给其他服务做优化时的交接包

### 9.1 给 OpenClaw 服务

需要说明：

```text
本项目调用 /v1/responses。
payload model 固定为 openclaw。
目标 agent 使用 OpenClaw 默认配置，当前为 main；如需固定 agent，可改成 openclaw/<agentId>。
channel 通过 x-openclaw-message-channel=feishu 传递。
session 通过 x-openclaw-session-key 传递；Bridge 绑定会话时该值应为 Feishu external_session_key。
HTTP 请求带 x-openclaw-scopes。
```

希望 OpenClaw 关注：

| 优化点 | 背景 |
| --- | --- |
| `/v1/responses` 响应稳定性 | `model=openclaw` 当前可走默认 `main`，OpenClaw 侧默认模型已切到 `custom/gpt-5.5` |
| `/v1/responses stream=true` | 已验证返回 `text/event-stream`、`response.output_text.delta`、`response.completed` |
| model 参数约束 | 当前 responses 要求 `model` 字符串，`openclaw` 有效 |
| `/v1/audio/speech` | 当前返回 404，如要统一音频需 Gateway 侧支持 |
| WebSocket RPC | Bridge 依赖 `sessions.list`, `chat.history`, `sessions.messages.subscribe`；realtime 可选用 `agent`/`chat` delta 事件 |

### 9.2 给 TTS 服务

需要说明：

```text
本项目通过 POST /api/v1/tts 提交任务。
通过 GET /api/v1/tasks/{task_id} 轮询状态。
完成后读取 audio_url。
FastAPI 保存 remote_audio_url，不把音频写入 SQLite。
前端播放时走 Next.js /api/backend/tts/proxy/{tts_id}?user_id={user_id}，由 FastAPI 再代理 remote_audio_url。
```

希望 TTS 关注：

| 优化点 | 背景 |
| --- | --- |
| 任务完成时间 | 前端同步等待有限，超时会进入 pending + worker |
| 错误信息 | 当前错误会写入 trace 和 message_tts.error |
| audio_url 可访问性 | `/tts/proxy/{tts_id}` 依赖 remote URL 仍可下载 |
| emotion/pause 参数 | 请求会传 `emotion_label` 和 `pause_profile` |

### 9.3 给前端/MMD 渲染侧

需要说明：

```text
前端不直接调用 OpenClaw 和 TTS 外部服务。
前端统一调用 Next.js /api/backend/*，由其转发 FastAPI。
前端会在有用户 session 后静默加载 Bridge 状态，并在 Bridge 启用时跟随默认 binding 的本地会话。
Chatbox 消息列表使用普通文档流渲染，不再使用绝对定位虚拟行；滚动容器直接依赖 DOM 内容高度，避免长回复、窄面板或 TTS/trace 状态变化时因行高测量失准造成 chat item 重叠。
MMD 舞台业务状态由 stageInteractionMachine 维护，MMDStage/Runtime 只执行当前 interaction。
点击人物时，MMDStage 只接受短按、小位移的普通点击；长按和拖动不会触发。通过 runtime raycast 确认真正命中模型后，前端显示一次点击波纹，并切到当前模型 favorite VMD 随机单次动作。点击动作会优先使用 `02_greeting_social`、`05_soft_emotion`、`06_strong_personality` 中有 URL 的 VMD；这些单次点击动作即使 `motion_profile.companion_safe=false` 也允许进入候选池，播放时统一 `lockLowerBody=true`/`disableCrossfade=true`。候选会按 category + 规范化文件名去重，并在存在其它候选时避开上一次点击动作，避免连续触发同一动作；没有分类候选时才回退到安全 favorite 池，再没有则回退 procedural wave。
MMD 模型 URL 来自 /assets/mmd/models。
VMD 动作 URL 来自 /assets/vmd/file/{asset_id}。
```

希望前端关注：

| 优化点 | 背景 |
| --- | --- |
| 消息状态展示 | assistant_message 可能 degraded/fallback |
| TTS 状态展示 | `tts.status` 可能 ready/pending/failed/expired/partial_failed |
| 动作 fallback | `motion_resolution.status` 可能 fallback_idle |
| 人物点击 | 点击命中检测在 `MMDCompanionRuntime.hitTestModelAtClientPoint()`，视觉波纹在 `MMDStage` 层，动作选择在 `stageCharacterClick`；优先随机 `02_greeting_social`、`05_soft_emotion`、`06_strong_personality`，候选会按动作名去重并避开上一次点击动作 |
| 动作状态机 | `default_idle/autoplay_loop/manual_preview/chat_vmd_action/chat_procedural_action/stage_click_vmd_action/stage_click_procedural_action/recovering` 在 `stageInteractionMachine` 中显式维护，避免页面里多处 setter 各自拼状态 |
| 动作完成/异常恢复 | 聊天或预览动作正常完成后会重新从当前模型的 `00_idle_loop` 随机生成本次待机 VMD loop interaction，不依赖 `pendingAutoResume` 标记，也不复用上一次固定 lead VMD；没有分类待机循环时回退旧安全收藏动作池，再没有则默认 procedural idle。VMD/动作播放失败会由 Stage 上报页面，页面立即走同一套收藏优先恢复逻辑 |
| 资源加载错误 | PMX 贴图依赖原包相对路径 |

### 9.4 给 realtime voice 实现侧

当前 realtime voice 已有 Phase 1 可用链路：后端提供 session WebSocket、TTS chunk client、session queue、chunk proxy；前端提供 WebSocket URL helper、AudioQueue 和 Companion 页面接入。它仍是语音侧链路，消息文本生成和持久化仍以 Message Service v2 为主链路。

第一版熔断和限流边界：

```text
只做 session 级 realtime voice circuit breaker。
不做全局 user/workspace 级 rate limit。
queue_full 立即 rejected(queue_full, fallback=message_tts)，并计入 session failure window。
TTS chunk timeout/failed、OpenClaw stream failed、proxy failed、frontend playback failed 计入同一 session failure window。
failure window 达到阈值后，该 session circuit 进入 open，新 job rejected(circuit_open, fallback=message_tts)。
half_open 只允许一个探测 job，其余 job 仍 fallback。
```

第一版 WebSocket 身份合同：

```text
WS /ws/sessions/{session_id}/voice?user_id={user_id}
```

后端将 query `user_id` 映射到 Message Service v2 当前使用的 `x-user-id` 权限模型。缺失、为空或无权访问 `session_id` / workspace 时拒绝连接。第一版不使用首个 `auth` message，也不引入 token。

主要 WebSocket 事件：

```text
client -> synthesize { job_id, message_id, text, emotion_label? }
server -> queued { queue_position }
server -> synthesis_started
server -> audio_ready { job_id, sequence, text, audio_url, duration, elapsed_seconds }
server -> done
server -> rejected { reason, fallback=message_tts }
server -> error { detail }
client -> cancel { scope=all }
server -> cancelled
```

音频代理合同：

```text
GET /tts/proxy/realtime/{session_id}/{job_id}/{sequence}?user_id={user_id}
```

前端播放合同：

```text
sessionVoiceWebSocketUrl(sessionId, userId)
AudioQueue.enqueue({ jobId, messageId, sequence, url })
AudioQueue.hasPlayedChunk(jobId)
AudioQueue.fallbackForJobError(jobId)
```

fallback 规则：

| 场景 | 行为 |
| --- | --- |
| queue/circuit/realtime 失败且该 job 尚未播放任何 chunk | 自动回退到现有长任务 `message_tts` |
| 已经播放过至少一个 chunk 后失败 | 标记 `tts.status=partial_failed`，只提示手动重播 |
| 会话切换/新建会话/组件卸载 | 发送 `cancel(scope="all")`，清空本地 AudioQueue |
| 新用户消息 | 不默认取消旧 realtime voice job |

## 10. 排障入口

| 症状 | 优先检查 |
| --- | --- |
| 前端请求 502 | Next.js `/api/backend/*` 到 FastAPI 的转发 |
| FastAPI 不可用 | `GET /healthz` |
| 服务端全景状态 | 前端 `/status` 或 `GET /admin/runtime-health` |
| OpenClaw 文本失败 | `GET /healthz/openclaw` |
| OpenClaw 超时 | 检查 `OPENCLAW_MODEL`, OpenClaw 默认 agent/model, Gateway 状态 |
| TTS 无声音 | 查 `message_tts.status`, `tts_jobs`, TTS 服务任务状态，浏览器 Network 里 `/api/backend/tts/proxy/{tts_id}?user_id=...` 是否 2xx |
| TTS 引用 `tts_job_max_attempts_exceeded` | 旧 worker 会在 TTS 仍 processing 时提前失败；当前逻辑应保持 pending 并继续轮询，既有 failed 记录需要重新生成或恢复为 pending 后再轮询 |
| 音频 URL 过期 | `POST /message-tts/{tts_id}/mark-expired` 或重新生成 |
| Bridge 不同步 | 先看 `/status` 或 `GET /admin/runtime-health` 的 Bridge latest_message / recent_errors，再看 `GET /admin/message-bridge/status` |
| 找不到 Feishu session | `GET /admin/message-bridge/openclaw/feishu/sessions`；该接口会实时连 OpenClaw WebSocket，失败时应看 502 detail 和 trace 中的 `message_bridge.openclaw.sessions.list` |
| MMD 模型不显示 | `GET /assets/mmd/validate?model_path=...` |
| 模型贴图丢失 | 检查模型包相对路径和 `GET /assets/mmd/{file_path}` |
| 动作不匹配 | 检查 favorite VMD 是否绑定到当前 selected model |

## 11. 当前已知事实

| 项 | 当前事实 |
| --- | --- |
| OpenClaw `/v1/models` | 可用 |
| OpenClaw `/v1/responses` | `model=openclaw` 可用，默认走 OpenClaw 当前默认 agent/model |
| OpenClaw `/v1/responses stream=true` | 可用，返回 `response.output_text.delta` |
| OpenClaw `/v1/chat/completions` | 可返回 SSE envelope，但主链路当前走 responses |
| OpenClaw `/v1/audio/speech` | 当前 404 |
| OpenClaw WebSocket RPC | 可连接，`sessions.list` 可返回 Feishu sessions；`agentId=main` 可返回 assistant delta |
| Voice Workflow TTS `/api/v1/tts` | 可用；2026-05-13 优化后 smoke test：提交 `202` 耗时 147ms，约 17.456s ready，返回 `audio/wav` 184400 bytes，`RIFF` header |
| Voice Workflow TTS `/api/v1/tts/chunk` | 可用；2026-05-13 优化后 smoke test：响应字段包含 `duration`，两次短句请求耗时 14.992s / 14.687s，服务端 `elapsed_seconds=14.975/14.675`，返回 `audio/wav` 138320 bytes，`RIFF` header；较旧基线约 22.7s / `20.063s` 改善，但仍是 realtime 首段延迟瓶颈 |
| Voice Workflow TTS | 当前作为实际服务端语音链路 |
| Message TTS audio proxy | 前端通过 `/api/backend/tts/proxy/{tts_id}?user_id={user_id}` 播放，后端也兼容旧的 `x-user-id` header 访问 |
| Realtime Voice WebSocket | Phase 1 已接入 `WS /ws/sessions/{session_id}/voice?user_id={user_id}`，后端按 session queue 生成 chunk，前端 AudioQueue 顺序播放 |
| Realtime Voice audio proxy | Phase 1 已接入 `/tts/proxy/realtime/{session_id}/{job_id}/{sequence}?user_id={user_id}`，使用内存 chunk registry 代理远端 chunk URL |
| 本地健康检查 | `/healthz/openclaw` 已用于 models/responses 探测；`/admin/runtime-health` 和前端 `/status` 用于只读查看 API/OpenClaw/Bridge/TTS/SQLite 当前运行状态 |

## 12. 系统边界

本项目负责：

- UI 和 MMD 渲染。
- 会话、消息、资源、trace 的本地持久化。
- 调用 OpenClaw 生成文本。
- 调用 Voice Workflow TTS 生成音频。
- 把 OpenClaw/Feishu 消息通过 Bridge 同步回本地。

本项目不负责：

- OpenClaw Gateway 内部模型路由和 agent 运行。
- Feishu channel 的底层连接实现。
- TTS 模型文件和音频生成服务本身。
- PMX 包内贴图路径修复。

因此做跨服务优化时，先确认问题落在哪个边界：

```text
UI 体验问题 -> web/
API 编排问题 -> api/app/routes + api/app/services
文本生成质量/延迟 -> OpenClaw Gateway / target agent
语音生成质量/延迟 -> Voice Workflow TTS
消息同步问题 -> OpenClaw WebSocket RPC + MessageBridgeService
模型/动作显示问题 -> MMD_ROOT_DIR + assets API + MMDStage
```

## 13. Daily Podcast Topology

Updated: 2026-05-21

Daily Podcast is owned by FastAPI. The browser and Next.js UI do not assemble
Voice Workflow storage URLs directly. Next.js calls the FastAPI podcast API
through the existing same-origin `/api/backend/*` proxy, and audio playback
uses the same proxy path so browser `<audio>` and Canvas waveform fetches do
not expose Voice Workflow internals.

FastAPI podcast routes:

```text
GET /podcasts/daily/latest
POST /podcasts/daily/refresh
GET /podcasts/daily?days=30
GET /podcasts/daily/{date}
GET /podcasts/daily/{date}/audio?format=preferred
```

Voice Workflow interface 5 relationship:

```text
FastAPI -> Voice Workflow optional POST /api/v1/podcast/daily/refresh
FastAPI -> Voice Workflow /api/v1/eula-storage-audio/podcast/latest.json
FastAPI -> Voice Workflow /api/v1/eula-storage-audio/podcast/YYYY/MM/DD/podcast_YYYYMMDD.meta.json
FastAPI -> Voice Workflow audio OGG/WAV with ranged GET
```

`POST /podcasts/daily/refresh` is the only browser-facing manual generation
entrypoint. It applies a FastAPI in-memory 10 second cooldown before calling
Voice Workflow, so repeated clicks return the latest readable podcast payload
without repeatedly hitting the Voice service. The current Voice Workflow
OpenAPI exposes storage and TTS endpoints but may not expose an HTTP podcast
refresh route; if the optional refresh call returns `404` or otherwise fails,
the route still reads and returns the latest podcast metadata/audio state and
adds the refresh error to the response metadata instead of clearing the card.

Voice Workflow may return Eula storage references either as relative
`podcast/YYYY/...` paths or as absolute paths on the Voice host. FastAPI
normalizes absolute paths by extracting the `podcast/...` suffix before calling
the storage-audio endpoint, so host filesystem prefixes are not exposed to the
browser and do not break proxy resolution. Podcast `meta.json` is accepted in
both the older flat shape (`docUrl`, `audio.oggPath`, `audio.wavPath`) and the
current published shape (`artifacts.docUrl`,
`artifacts.audio.oggPath`, `artifacts.audio.wavPath`).

If Voice Workflow disconnects or times out during Daily Podcast metadata reads,
FastAPI returns a normalized degraded podcast payload instead of surfacing a
500 response: latest maps to `status="failed"` with `audio_error`, and recent
history returns an empty list when the latest pointer cannot be read.

Frontend surfaces:

```text
/companion right rail Daily Podcast card
/podcasts Daily Podcast history/playback page
```

The root `/` route is the AETHER V2 login entry. It uses the source bitmap
assets in `web/public/images/loginV2`, keeps real HTML inputs and buttons over
the visual shell, saves `mmd_companion_session_v1` in browser localStorage, and
routes to `/companion`. The panel element itself is transparent and the
`::before` overlay is disabled so no extra frosted-glass/tint rectangle sits
behind the source bitmap. The visible floating window comes from the translucent
source-bitmap `::after` frame, and the primary login CTA now uses the custom
center-beacon button asset
`login_button-v2-transparent.png`. Before the form appears, the root login
route plays `/images/loginV2/login_video.mp4` as a full-screen intro overlay.
The intro state machine is `active -> revealing -> complete`: video `ended` or
a double-click on the intro overlay starts `revealing`, the intro layer is
hidden immediately, and `/images/loginV2/idle_loginV4.mp4` takes over as the muted
looping page background without a CSS video fade. The login UI then fades upward
like surfacing from water, and the panel animation end moves the state to
`complete`. The older static `login_background.png` image is hidden while this
video-backed login scene is active. The desktop login panel keeps the source
bitmap frame ratio but enforces a content-height floor so the register button
and footnote remain inside the glass frame on mid-width desktop viewports. The login entry
preserves `ttsEnabled` while
normalizing `ttsMode` to the default
server-backed mode; `/companion` applies the same migration on startup so older
`browser` selections do not leak into the new UI. The visible voice mode
control is an on/off playback toggle, not a browser/server selector; clicking
it updates `ttsEnabled`, persists that value, and immediately stops any current
audio when toggled off. On short desktop viewports (`min-width: 901px` and
`max-height: 720px`), the login panel keeps its compressed spacing but lets the
panel height follow its content so the footnote and actions stay inside the
source-bitmap window instead of being clipped by the fixed aspect ratio. On
middle-width compact viewports (`521px-900px`, `max-height: 700px`), the same
login entry also caps the panel width from viewport height and tightens the
brand/form spacing so the window, security strip, and copyright remain visible
without oversized tablet-style scaling. Across desktop, tablet-width, and phone
breakpoints, the floating login window keeps a protected left/right content
inset for the title, fields, action buttons, and footnote; very short phone
viewports compress vertical spacing instead of sacrificing that inline padding.
The compact `598x622` layout uses the measured login CTA as the scale anchor:
the CTA is reduced from about `363.6x46` to `327.2x41` and sibling controls,
titles, and wordmark dimensions are derived from the same roughly 0.9 scale.

The `/companion` bottom command bar is tied to the Penpot bottom-bar design
file in `Design/*.pen`. Its desktop fidelity metrics are checked by
`npm --prefix web run check:basic`: command bar height 83px, shell side padding
6px, shell gap 10px, TTS toggle 110px, mic button 54px, send button 64px,
voice-mode button 108px, and advanced-mode button 118px.

The `/companion` right rail card keeps the hidden podcast `<audio>` element at
the `CompanionRightRail` level instead of inside the overview card body. The
overview card can unmount when the user switches to chat/tasks/tools panels,
but the audio element and playback state stay mounted in the right rail so the
play action is still available when the user returns to overview. The card shows
one SVG-style play/pause button, a primary Feishu document action, and a
secondary podcast list entry. Manual refresh calls `POST /podcasts/daily/refresh`
through `/api/backend/*`; the backend enforces the 10 second Voice cooldown,
then returns the current latest podcast payload so the existing card state can
update in place.

Audio policy:

```text
Daily Podcast only: audio/ogg preferred, audio/wav fallback, ranged GET probe.
Older TTS/realtime audio OGG migration remains deferred.
```

## 14. Local ImgToAction Text-to-Motion/VMD Pipeline

Updated: 2026-06-18

`imgToAction` now contains a local, CLI-first motion-to-VMD pipeline for the
first `thinking_chin_edge` action. It accepts external MoMask `.npy` candidates
and BVH candidates. This path is development/offline tooling; it is not called
by the FastAPI API, Next.js UI, desktop pet runtime, or the main MMD asset
endpoints in v1.

Current responsibility split:

```text
External MoMask / HumanML3D environment
  -> one or more 22-joint .npy or BVH motion candidates
    -> imgToAction/tools/generate_action_vmd.py
      -> skeleton.json import
      -> bvh_motion.json sidecar for BVH local channels/rotations/world positions
      -> draft.vmd retarget
      -> mode branch:
         action-fit:
           -> right-wrist-to-chin-edge constraint
           -> static hand preset overlay
           -> thinking_chin_edge quality score
         preserve-source-motion:
           -> no action constraint
           -> no hand preset overlay
           -> retarget_fidelity_report.json
      -> quality_report.json per candidate
      -> selection_report.json
      -> final.vmd + requested --out VMD
```

The pipeline accepts existing `.npy` and `.bvh` outputs only. It does not
download, install, launch, or supervise MoMask or any video generator. Generated
artifacts remain local under `imgToAction/outputs/actions/<action>/run_*` plus
the explicit `--out` VMD path.

`generate_action_vmd.py` defaults to `--mode action-fit`, which keeps the
first Eula thinking-pose fitting behavior. `--mode preserve-source-motion` is
for BVH/MoMask source debugging and first-pass retarget validation: it writes
the imported skeleton and draft/final VMD from the same unconstrained retarget,
skips the action semantic score, skips contact IK and hand presets, and records
a `retarget_fidelity_report.json`. The first fidelity report only proves the
source skeleton was preserved through the local generator branch; it does not
measure rendered PMX fidelity yet.

The Eula PMX retargeter treats the upper-arm, elbow, and wrist chains as
horizontal T/A-pose rest axes (`right=-X`, `left=+X`) before aiming them at the
imported skeleton joint directions. This is required for BVH motions whose
source skeleton contains relaxed/down arms or right-hand-to-face poses; using a
downward rest axis leaves the PMX model close to its default arms-out pose.
The current action-fit contact target for Eula is calibrated to
`target_offset=[0.12, 0.105, 0.09]` in the imported skeleton head-relative
coordinate space. This value was selected by repeated PMX render checks through
`imgToAction/tools/render-vmd-pose-check.mjs`, minimizing the projected
right-wrist-to-chin distance over the final hold frames while keeping the left
hand near the waist.

`imgToAction` also keeps the existing optional MediaPipe reference-landmark
extraction path for generated multi-view reference images. MediaPipe outputs are
used as reference landmarks and target descriptions; they are not a video
motion-capture runtime and do not directly generate VMD.

For reference-image fitting, `imgToAction` also has a direct local-bone pose
branch:

```text
reference_landmarks.eula_thinking.json + seed VMD
  -> imgToAction/tools/optimize-direct-pose.mjs
     -> Playwright opens /mmd-calibration-render once
     -> captures seed local PMX bone quaternions
     -> optimizes head/torso/arm local quaternions against rendered landmarks
     -> writes direct_pose.json
  -> imgToAction/tools/direct_pose_to_vmd.py
     -> writes a VMD directly from local bone quaternions
  -> imgToAction/tools/render-vmd-pose-check.mjs
     -> screenshot/contact-sheet verification
```

This branch is still offline tooling. It intentionally writes only local bone
rotations by default; captured Three.js `bone.position` values are PMX rest
offsets and must not be written as VMD translation channels unless a future
tool explicitly marks a bone with `writePosition=true`. Current reference
landmark scoring is useful for wrists/elbows/contact but not yet a full visual
similarity metric: PMX shoulder/head bone origins do not exactly match
MediaPipe person landmarks, and the next quality step should use silhouette or
mesh-aware scoring rather than synthetic shoulder-width penalties.

Direct-pose visual iteration can now use
`imgToAction/tools/create-direct-pose-variants.mjs` to apply local-axis bone
delta sweeps or one-off delta combinations to an existing `direct_pose.json`.
The tool writes variant `direct_pose.json` files and a manifest only; each
candidate still has to be converted through `direct_pose_to_vmd.py` and
verified through `render-vmd-pose-check.mjs` because optimizer RMSE and wrist
bone origins do not reliably predict rendered PMX visual similarity.

The direct-only visual candidate
`imgToAction/outputs/vmd/eula_thinking_direct_fit80_candidate.vmd` is now
explicitly rejected as a final action. It can satisfy a front-view wrist/contact
projection gate, but multi-angle renders under
`imgToAction/outputs/actions/thinking_chin_edge/human_check_fit80_*` show
non-human arm composition: the left arm moves behind the body and the right hand
contact relies on front-view projection/occlusion rather than a readable
shoulder-elbow-wrist chain.

The current local first-loop candidate is instead a composite VMD:

```text
community natural baseline
  MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/03_thinking_waiting/思考1.vmd
    -> imgToAction/tools/vmd_io.py
       reads/writes full bone-frame payloads and preserves 64-byte interpolation
    -> imgToAction/tools/overlay_vmd_bone_frames.py
       overlays only selected direct-pose bones in a target frame window
       keeps lower body, fingers, center, and natural timing from the baseline
       adds a low-strength left-arm waist-support overlay from the community watch-time VMD
    -> imgToAction/outputs/vmd/eula_thinking_elegant_reference_v1.vmd
    -> imgToAction/tools/render-vmd-pose-check.mjs
       front / front-right 45 / right-side screenshots with explicit camera snapshots
```

For `eula_thinking_elegant_reference_v1.vmd`, the selected candidate is
`eula_thinking_composite_elegant_v16_leftsupport_delayed90.vmd` copied to the stable
output name. The first overlay window maps direct-pose frames 30-90 onto
baseline frames 60-178. It keeps the baseline `右肩` instead of hard-overriding
it, then overlays `右腕`, `右ひじ`, `右手首`, `上半身`, `上半身2`, `首`, and
`頭`. A second 90-178 overlay applies `左肩`, `左腕`, `左ひじ`, and `左手首`
from
`MMD/usage/vmd/优菈_by_原神_339146e6e418d79e85a515b26414c0b0[动作]/03_thinking_waiting/看时间.vmd`
at strength `0.55`, giving the final pose a restrained waist/front support arm
without crowding the chest or locking the support arm during the early f60
transition. This preserves the community VMD's natural lower body, fingers,
center, motion timing, and calmer shoulder line while bringing the right hand
close to the chin/lips. Verification artifacts live under:

```text
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v16_default/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v16_front45/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v16_right_side/
```

`render-vmd-pose-check.mjs` now parses `--camera` as strict JSON, applies the
requested camera directly through `window.__mmdCompanionRuntime.applyCameraSnapshot`,
and records both `requestedCamera` and `actualCamera` in `render_metrics.json`.
This is required for trustworthy multi-angle validation; without it, invalid
PowerShell-escaped camera JSON silently fell back to the default front camera.
The same checker now samples shoulders and elbows, computes per-frame elbow
angles, reports all-frame `quality_violations`, and makes the visible sheet
pass/fail status depend on `overall_motion_quality` instead of only final
right-hand contact. Final right-hand contact now has two checks: the final hold
must be under the contact threshold, and once sampled frames enter the
chin-contact region the contact distance must remain stable instead of drifting
across the hold. The same contact-hold region also checks elbow and shoulder
angle drift, so the final thinking pose cannot keep changing arm shape while
the wrist remains close to the chin. A separate thinking-hand approach-phase
gate starts once the right wrist enters the configured approach region and
blocks large regressions away from the chin before the final hold, so a motion
cannot satisfy the final frame by snapping back after a non-human
away-and-return transition. The checker also derives a head/chin-facing front
vector from the shoulder midpoint and chin samples and blocks frames where the
right thinking hand has entered the approach/contact region but the wrist is on
the back side of the torso path. This catches the previous right-side f90
failure mode where quaternion interpolation moved the thinking hand behind the
body while the final contact still passed. It also has explicit
thinking-hand raise-phase and hold-entry gates: sampled preparation/approach
frames must move through the front-side raise corridor, and the first hold frame
must already be inside the chin-contact corridor instead of relying on a later
snap. The right-hand contact target is a model-profile
`render_target_offsets` region on the head/chin bone rather than one projected
point; the checker records the nearest selected chin sample in
`contact_pairs.right_wrist_to_chin`, which avoids side-view false negatives from
a single head-bone proxy. The first transition-phase rule blocks frames where
the left support arm locks near the waist before the right thinking hand has
approached the chin, but it now requires both 2D projection proximity and
`left_wrist_to_waist_world` proximity so front-right/side camera overlap does
not masquerade as an early support-arm lock. The visible contact sheet includes
both projected pixel distances and the left-wrist-to-waist world distance used
by that rule. A temporal elbow-angle delta gate also compares adjacent sampled
frames and blocks sudden left/right elbow flips that remain inside the static
angle range but would not be plausible human joint-chain motion. The checker
also samples hip/knee/ankle bones, blocks impossible knee angles across all
sampled frames, and compares adjacent sampled frames for sudden knee-angle
jumps, so lower-body retarget failures are no longer invisible to the upper-body
contact gates. It also records ankle world-space stance metrics and blocks
stationary actions where either ankle or the stance width drifts across sampled
frames. A shoulder upper-arm direction gate measures each
upper arm against the torso-down vector and blocks sampled frames where the
shoulder chain folds into a non-human direction; a matching shoulder
temporal-delta gate blocks sudden upper-arm direction snaps between adjacent
sampled frames. Render rows and contact sheets record these shoulder and knee
angles next to the elbow angles. The checker also
computes conservative torso-core clearance
from shoulder midpoint to lower body and blocks elbow/wrist endpoints that enter
that core volume, giving the first automated guard against obvious arm/torso
penetration without forbidding valid across-body support poses. Render rows also
record upper-arm/forearm segment-to-torso-core distances; the blocking segment
gate currently checks forearms only, because upper arms naturally start near the
shoulder midpoint and would otherwise create false positives on valid poses.
The summary still records upper-arm and forearm segment lengths and rejects
large relative length drift across sampled frames, catching non-human retarget
failures where a limb is stretched or compressed by incorrect bone position
channels.

`overlay_vmd_bone_frames.py` now includes a stationary stabilization pass that
can lock selected bone positions and rotations to a reference frame after VMD
composition, and `generate_action_vmd.py` applies the same pass when an action
recipe defines `vmd_stationary_stabilization`. The current stable Eula thinking
candidate uses this policy to lock center, foot IK, toe IK, waist, groove, leg,
and ankle lower-body channels while preserving the tuned upper-body thinking
gesture. The current single-raise candidate trims residual 48-58 frame keys from
the shoulder and left-arm support chains after the v11 right-arm cleanup, so
frames 30-60 are one continuous front-side raise instead of a second inherited
raise segment. The right arm, upper body, neck, and head keys are sparse through
`0,30,60,90,119,178`, and `holdStartFrame=60` is the action-specific hold
boundary for this pose. The validated VMD is:

```text
imgToAction/outputs/vmd/eula_thinking_elegant_reference_v12_single_raise.vmd
```

The current three-view dense verification artifacts sample
`0,30,36,42,48,54,60,90,120,178` and pass all coordinate gates with zero
blocking violations:

```text
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_default/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_front45/
imgToAction/outputs/actions/thinking_chin_edge/composite_elegant_v25_single_raise_right_side/
```

The current built-in target is Eula + `thinking_chin_edge`: stationary upper
body, right wrist near the chin edge, left arm near waist support, conservative
finger presets, and candidate scoring for contact distance, elbow naturalness,
head tilt, stance stability, smoothness, and blocking violations.

## 15. Development Code Search Tooling

Semble CLI is integrated as a development-only semantic code search helper. It
is not part of the runtime topology and is not called by FastAPI or Next.js.
Use it when a task is intent-based and cross-module, while keeping `rg` as the
first choice for exact identifiers, endpoint paths, filenames, and known
strings.

PowerShell wrappers:

```text
scripts/semble-search.ps1
scripts/semble-savings.ps1
```

Operational rules:

- Scope searches to `api/app`, `web/src`, or `docs` before searching the repo root.
- Use the wrappers on Windows so `PYTHONIOENCODING=utf-8` is set for Unicode output.
- Track notable token-saving observations in `docs/architecture/semble-code-search-observability.md`.
- Current integration is CLI-only; Codex global MCP integration is intentionally deferred.

## 16. 文档维护规则

后续只要更新功能、服务拓扑、外部服务集成、环境变量、数据落点、API 契约或运行时行为，都需要同步更新本文。

本文的目标不是记录所有实现细节，而是持续保持项目全景准确：

- 自己回看时，能快速理解当前系统怎么跑。
- 交给 OpenClaw、TTS、前端或渲染相关服务做优化时，对方能快速理解上下游边界。
- 排障时，能从症状快速定位到对应服务、接口、配置或数据落点。

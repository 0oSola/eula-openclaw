# 当前系统拓扑与架构蓝图

更新时间：2026-05-30

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
| FastAPI API | `api/`, 默认 `http://127.0.0.1:8000` | 会话、消息、OpenClaw/TTS 代理、realtime voice WebSocket、资源、trace、admin API | 本项目内 | `GET /healthz`、`GET /admin/runtime-health` |
| OpenClaw Gateway HTTP | `http://10.11.252.164:18789` | `/v1/models`、`/v1/responses` 文本生成 | 外部服务 | `GET /healthz/openclaw` |
| OpenClaw Gateway WebSocket RPC | `ws://10.11.252.164:18789` | Feishu session 列表、history、实时消息订阅、agent/chat delta 事件 | 外部服务 | Bridge admin 状态、`sessions.list` |
| Voice Workflow TTS | `http://10.11.252.164:5555` | 提交 TTS、查询任务、返回音频 URL | 外部服务 | `POST /api/v1/tts` + `GET /api/v1/tasks/{task_id}` |
| Codex Interactive | FastAPI 内 `CodexInteractiveProvider`，目标进程为 `codex app-server --listen stdio://` | 产品内 Codex Console、只读/patch 多轮事件流、worktree diff、approval、checks、apply | 本项目内，默认关闭 | `GET /admin/runtime-health` 的 `codex` 字段 |
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
```

当前文本生成应使用：

```text
payload.model = openclaw
x-openclaw-agent-id = main
x-openclaw-message-channel = feishu
```

不要把 `OPENCLAW_MODEL` 配成 `minimax-portal/MiniMax-M2.7`。当前 Gateway 对这种 model 名会返回无效模型或导致链路不可用。OpenClaw 默认 agent 当前走 `main`，默认模型由 OpenClaw 侧维护；MMD 项目不固定到业务专用 agent。OpenClaw `/v1/audio/speech` 当前实测为 404，实际音频链路不走这个接口。

Codex interactive 默认关闭。打开时必须同时配置 `CODEX_ALLOWED_USERS`、`CODEX_ALLOWED_WORKSPACES` 和对应的 `CODEX_WORKSPACE_*` 路径。浏览器不直连 Codex app-server；当前实现由 FastAPI 管理只读和 patch session、WebSocket 事件流、SQLite 事件/approval/artifact 落库和右侧 Tasks 面板 Console。生产 provider 会为每个 Codex session 启动本地 `codex app-server --listen stdio://`，通过 stdin/stdout JSONL JSON-RPC 调用 `initialize`、`thread/start`、`turn/start` 和 `turn/interrupt`。FastAPI 只给 app-server 传白名单环境变量：`PATH`、`HOME`、`CODEX_HOME`、`NO_COLOR`，不会传 OpenClaw、TTS、数据库或 Feishu 相关密钥。Windows 上如果 `CODEX_BIN` 解析到 npm 的 `codex.cmd` shim，后端会优先定位同包内的 native `codex.exe` 再启动，避免 shim 进程的 stdio/lifecycle 问题；找不到 native executable 时才退回 shim。

Patch session 会通过 `CodexWorktreeManager` 在 `CODEX_WORKTREE_ROOT` 下创建独立 git worktree，sandbox 固定为 `workspace-write`；read-only session 在 allowlisted workspace 下运行，sandbox 固定为 `read-only`。app-server notification 会在 FastAPI 归一化为稳定 UI 事件，例如 `item/agentMessage/delta -> text_delta`、`item/plan/delta -> plan_delta`、`item/commandExecution/outputDelta -> command_output`、`item/fileChange/patchUpdated -> file_changed`、`turn/completed -> turn_completed`。app-server 发起的 approval server request，例如 `item/commandExecution/requestApproval`、`item/fileChange/requestApproval`，以及旧式 `execCommandApproval`、`applyPatchApproval`，会先落 SQLite，再等待前端 approve/deny；用户决策会通过同一个 JSON-RPC request id 回传给 app-server。Diff/check/apply 都围绕 worktree 执行；patch turn 完成后会自动生成 diff artifact，也支持前端手动刷新 diff。Apply 必须满足无 unresolved approval、显式 `confirm=true`、主 workspace 干净，并通过 `git apply --check` 后才会把 patch 写回主 workspace。测试可通过 `codex_use_deterministic_provider` 覆盖使用 deterministic provider，不启动真实 app-server。

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
| `POST /codex/interactive/sessions` | 创建只读或 patch Codex session；patch 模式会创建独立 git worktree |
| `WS /ws/codex/interactive/{session_id}` | Codex Console 事件流，支持 user message、cancel、approval decision、close |
| `GET /codex/interactive/{session_id}/diff` | 从 session worktree 读取 changed files、stat 和 patch，并写入 diff artifact |
| `POST /codex/interactive/{session_id}/approvals/{approval_id}` | 持久化 `approve_once` 或 `deny` 决策、写入 approval event，并回传给 app-server |
| `POST /codex/interactive/{session_id}/checks` | 在 worktree 内运行后端配置的 checks，并写入 checks artifact |
| `POST /codex/interactive/{session_id}/apply` | 在 approval/clean/confirm/apply-check gate 后，把 worktree patch apply 到主 workspace |
| `POST /codex/interactive/{session_id}/discard` | 关闭 session，并按请求移除对应 worktree |

`GET /messages/greetings/latest` 会从本地 SQLite 查当前用户最新一条 `metadata.greeting_cron` 或 `metadata.auto_tts=true` 的 assistant 消息，并返回同一个 message response 结构（含 `tts` 引用）。Companion 页面进场时会调用该接口，气泡优先显示这条问候文本；如果该消息的 `tts.status=ready` 且有 `remote_audio_url` 或 `proxy_audio_url`，前端会在本页会话内只自动播放一次对应语音。找不到问候消息时，气泡回退到当前 Chatbox 最新 assistant 消息或默认文案。

`GET /admin/runtime-health` 不主动调用 `sessions.list`，因此 OpenClaw Gateway WebSocket 握手慢或 Feishu session list 不稳定时，健康后台仍能打开并显示本地已经收到的消息、最后连接时间、最新错误和 TTS/SQLite 状态。前端 `/status` 页面每 5 秒读取一次该接口；Companion 页面里的 Bridge 状态加载也已经把 `GET /admin/message-bridge/status` 和 `GET /admin/message-bridge/openclaw/feishu/sessions` 解耦，后者超时只会标记 session list 不可用，不会清空本地 Bridge status，也不会停止 2.5 秒一次的消息刷新轮询。`/admin/message-bridge/openclaw/feishu/sessions` 失败时返回 502，并写入 `message_bridge.openclaw.sessions.list` error trace，避免 ASGI 500 堆栈遮蔽根因。

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
| 聊天消息 | SQLite `messages` |
| TTS 状态 | SQLite `message_tts`, `tts_jobs` |
| OpenClaw Bridge | SQLite `message_bridge_bindings`, `message_bridge_state` |
| 动作解析结果 | SQLite `message_motion_resolution` |
| VMD 资产索引 | SQLite `asset_registry` |
| Motion context exports | SQLite `motion_context_exports` |
| trace event | SQLite `trace_events` + NDJSON |
| chat mirror | SQLite `chat_mirror` |
| retry job | SQLite `retry_jobs` |
| 本地 PMX/PMD/贴图 | `MMD_ROOT_DIR` |
| 上传/存储的 VMD | `API_DATA_DIR` 下的 storage；收藏副本在 `MMD_ROOT_DIR/usage/vmd/{model}[动作]/`，可按动作意图继续分子目录 |

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

## 14. Development Code Search Tooling

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

## 15. 文档维护规则

后续只要更新功能、服务拓扑、外部服务集成、环境变量、数据落点、API 契约或运行时行为，都需要同步更新本文。

本文的目标不是记录所有实现细节，而是持续保持项目全景准确：

- 自己回看时，能快速理解当前系统怎么跑。
- 交给 OpenClaw、TTS、前端或渲染相关服务做优化时，对方能快速理解上下游边界。
- 排障时，能从症状快速定位到对应服务、接口、配置或数据落点。

# 当前系统拓扑与架构蓝图

更新时间：2026-05-12

本文用于两类场景：

1. 自己快速理解当前项目全景、服务边界和调用关系。
2. 把必要背景交给 OpenClaw、TTS、前端或渲染相关服务做优化时，让对方能先理解上下游约束。

本文只描述当前运行形态，不描述理想重构方案。令牌、密钥等敏感值不写入本文。

## 1. 一句话概览

当前项目是一个浏览器端 MMD 虚拟陪伴系统。前端由 Next.js 承载，后端由 FastAPI 负责会话、资源、OpenClaw 调用、TTS 调用和 trace 记录。文本能力来自 OpenClaw Gateway，语音能力来自独立的 Voice Workflow TTS 服务，MMD/PMX/VMD 资源来自本地 `MMD_ROOT_DIR`。

```text
Browser / Next.js UI
  -> Next.js backend proxy /api/backend/*
    -> FastAPI API
      -> OpenClaw Gateway HTTP
      -> OpenClaw Gateway WebSocket RPC
      -> Voice Workflow TTS
      -> SQLite + NDJSON
      -> Local MMD/VMD files
```

## 2. 服务清单

| 服务 | 当前地址/位置 | 主要职责 | 当前状态 | 健康检查/验证 |
| --- | --- | --- | --- | --- |
| Next.js Web | `web/`, 默认 `http://localhost:3000` | UI、MMD 舞台、Chatbox、设置面板、trace 页面 | 本项目内 | 页面访问、`npm --prefix web run check:basic` |
| Next.js API Proxy | `/api/backend/*` | 浏览器同源转发到 FastAPI | 本项目内 | 前端请求是否 2xx |
| FastAPI API | `api/`, 默认 `http://127.0.0.1:8000` | 会话、消息、OpenClaw/TTS 代理、资源、trace、admin API | 本项目内 | `GET /healthz` |
| OpenClaw Gateway HTTP | `http://10.11.252.164:18789` | `/v1/models`、`/v1/responses` 文本生成 | 外部服务 | `GET /healthz/openclaw` |
| OpenClaw Gateway WebSocket RPC | `ws://10.11.252.164:18789` | Feishu session 列表、history、实时消息订阅、agent/chat delta 事件 | 外部服务 | Bridge admin 状态、`sessions.list` |
| Voice Workflow TTS | `http://10.11.252.164:5555` | 提交 TTS、查询任务、返回音频 URL | 外部服务 | `POST /api/v1/tts` + `GET /api/v1/tasks/{task_id}` |
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
OPENCLAW_TIMEOUT_SECONDS=15

TTS_SERVICE_ENABLED=true
TTS_SERVICE_BASE_URL=http://10.11.252.164:5555

API_DATA_DIR=api/data
MMD_ROOT_DIR=./MMD
ADMIN_USER_IDS=admin-1,sola
```

当前文本生成应使用：

```text
payload.model = openclaw
x-openclaw-agent-id = main
x-openclaw-message-channel = feishu
```

不要把 `OPENCLAW_MODEL` 配成 `minimax-portal/MiniMax-M2.7`。当前 Gateway 对这种 model 名会返回无效模型或导致链路不可用。OpenClaw 默认 agent 当前走 `main`，默认模型由 OpenClaw 侧维护；MMD 项目不固定到业务专用 agent。OpenClaw `/v1/audio/speech` 当前实测为 404，实际音频链路不走这个接口。

## 4. 主调用链：前端发消息

```text
User sends message in Chatbox
  -> web/src/lib/api.ts postSessionMessage()
  -> POST /sessions/{session_id}/messages
  -> FastAPI Message Service
  -> SQLite insert user message
  -> OpenClawClient.generate_reply()
  -> POST {OPENCLAW_BASE_URL}/v1/responses
  -> normalize_assistant_reply()
  -> SQLite insert assistant message
  -> resolve motion action against favorite VMD assets
  -> optional TTS flow
  -> response returns user_message + assistant_message
  -> frontend updates Chatbox and MMD stage
```

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
| OpenClaw 空内容 | 视为失败，进入 fallback |
| 回复 JSON 不完整 | `normalize_assistant_reply()` 做兼容，缺动作时 fallback idle |
| 动作无法匹配 VMD | `motion_resolution.status=fallback_idle` |

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
  -> pending: reschedule_tts_job()
```

播放代理：

```text
Frontend sees assistant_message.tts.proxy_audio_url
  -> GET /tts/proxy/{tts_id}
  -> FastAPI fetches remote_audio_url
  -> returns audio bytes to browser
```

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

## 6. OpenClaw Bridge 调用链

Bridge 是“同步 OpenClaw/Feishu 已有会话消息到本地”的链路，不是前端发消息的主链路。

```text
FastAPI lifespan
  -> if admin_user_ids and OPENCLAW_TOKEN:
       MessageBridgeService.run_forever(admin_user_ids[0])
         -> OpenClawGatewayProvider.connect()
         -> WebSocket RPC connect
         -> sessions.list
         -> choose latest Feishu session
         -> create/update local binding
         -> chat.history(limit=100)
         -> insert messages into local SQLite
         -> sessions.messages.subscribe
         -> receive session.message events
         -> insert realtime messages into local SQLite
```

Admin API：

| Endpoint | 作用 |
| --- | --- |
| `GET /admin/message-bridge/status` | 查看 Bridge 状态和当前绑定 |
| `PATCH /admin/message-bridge/settings` | 开关 Bridge 和实时驱动 |
| `GET /admin/message-bridge/openclaw/feishu/sessions` | 列出 OpenClaw Feishu sessions |
| `POST /admin/message-bridge/bindings/default` | 切换默认绑定 |

Bridge 依赖 OpenClaw WebSocket RPC 的 operator 权限和 scopes：

```text
operator.admin
operator.read
operator.write
operator.approvals
operator.pairing
```

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
| 上传/存储的 VMD | `API_DATA_DIR` 下的 storage |

## 9. 给其他服务做优化时的交接包

### 9.1 给 OpenClaw 服务

需要说明：

```text
本项目调用 /v1/responses。
payload model 固定为 openclaw。
目标 agent 使用 OpenClaw 默认配置，当前为 main；如需固定 agent，可改成 openclaw/<agentId>。
channel 通过 x-openclaw-message-channel=feishu 传递。
session 通过 x-openclaw-session-key 传递。
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
前端播放时走 FastAPI /tts/proxy/{tts_id}。
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
MMD 模型 URL 来自 /assets/mmd/models。
VMD 动作 URL 来自 /assets/vmd/file/{asset_id}。
```

希望前端关注：

| 优化点 | 背景 |
| --- | --- |
| 消息状态展示 | assistant_message 可能 degraded/fallback |
| TTS 状态展示 | `tts.status` 可能 ready/pending/failed/expired |
| 动作 fallback | `motion_resolution.status` 可能 fallback_idle |
| 资源加载错误 | PMX 贴图依赖原包相对路径 |

### 9.4 给 realtime voice 实现侧

当前 realtime voice 仍是规划链路，不是已上线主链路。第一版熔断和限流边界：

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

## 10. 排障入口

| 症状 | 优先检查 |
| --- | --- |
| 前端请求 502 | Next.js `/api/backend/*` 到 FastAPI 的转发 |
| FastAPI 不可用 | `GET /healthz` |
| OpenClaw 文本失败 | `GET /healthz/openclaw` |
| OpenClaw 超时 | 检查 `OPENCLAW_MODEL`, OpenClaw 默认 agent/model, Gateway 状态 |
| TTS 无声音 | 查 `message_tts.status`, `tts_jobs`, TTS 服务任务状态 |
| 音频 URL 过期 | `POST /message-tts/{tts_id}/mark-expired` 或重新生成 |
| Bridge 不同步 | `GET /admin/message-bridge/status` |
| 找不到 Feishu session | `GET /admin/message-bridge/openclaw/feishu/sessions` |
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
| 本地健康检查 | `/healthz/openclaw` 已用于 models/responses 探测 |

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

## 13. 文档维护规则

后续只要更新功能、服务拓扑、外部服务集成、环境变量、数据落点、API 契约或运行时行为，都需要同步更新本文。

本文的目标不是记录所有实现细节，而是持续保持项目全景准确：

- 自己回看时，能快速理解当前系统怎么跑。
- 交给 OpenClaw、TTS、前端或渲染相关服务做优化时，对方能快速理解上下游边界。
- 排障时，能从症状快速定位到对应服务、接口、配置或数据落点。

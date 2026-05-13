# MMD 实时语音需求拆解 Spec

日期：2026-05-13

关联输入：

- `docs/architecture/2026-05-13-cross-project-realtime-voice-spec.md`
- `docs/architecture/current-system-topology.md`
- `docs/specs/2026-05-08-message-service-v2-spec.zh-CN.md`

本文只拆解 MMD / Virtual Assistant 项目侧需求。Voice Workflow TTS 和 OpenClaw 的改造目标以跨项目 spec 为准；本文负责说明本项目如何接入、编排、降级、驱动前端播放和 MMD 舞台状态。

## 1. 背景

当前 MMD 项目的主要链路是：

```text
Companion UI
  -> POST /sessions/{session_id}/messages
  -> FastAPI Message Service
  -> OpenClaw /v1/responses
  -> SQLite 保存 assistant message
  -> Voice Workflow TTS 长任务 /api/v1/tts
  -> message_tts 保存 remote_audio_url
  -> frontend 点击或自动播放整段音频
  -> MMDStage speaking:boolean 驱动口型
```

这条链路可靠，但不是实时语音：必须等完整 TTS 任务 ready 后才能播放。跨项目目标是新增一条“OpenClaw 文本 delta streaming + sentence buffer + 短音频队列播放”的实时链路，让第一段音频尽早播放，并支持显式停止/清空队列。

## 2. 目标

- 在不替换现有 Message Service v2 的前提下，新增浏览器可用的实时语音侧链路。
- 后端负责通过 OpenClaw Gateway WebSocket 事件或本项目自包 adapter 接入文本 streaming、分句、维护 session 级 voice job queue、调用 Voice Workflow TTS 短 chunk API、代理音频 URL、处理显式取消和 trace。
- 前端负责 WebSocket 连接、按 message/job/sequence 排队播放、显式停止、兜底到现有长任务 TTS。
- MMD 舞台从单一 `speaking:boolean` 演进到可表达 buffering、speaking、ended、cancelled、error 的状态模型。
- Phase 1 目标是真文本 streaming：OpenClaw 运行时内部已有流式事件，但 MMD 项目侧要通过 Gateway WebSocket 事件，或自包一层把 Gateway/session 事件转换成统一 text delta。
- 不把 `/v1/responses stream=true` 作为已确认外部合同；如果没有可消费的 Gateway event schema 或 adapter，本项目只能降级为“完整 assistant 文本返回后再分句合成”，该降级不满足真 streaming 验收。

## 3. 非目标

- 不改用 OpenClaw `/v1/audio/speech`。当前拓扑记录该接口返回 404，语音仍由 Voice Workflow TTS 提供。
- 不替换 Qwen3-TTS `.pt` 克隆音色。
- 不让浏览器直连 Voice Workflow TTS 服务；浏览器只访问本项目 FastAPI 或 Next.js proxy。
- Phase 1 不要求真音频帧级流式；音频侧仍是短句 chunk 级播放。
- Phase 1 不强制新增语音 chunk 持久化表；trace 可先作为 chunk 状态记录来源。

## 4. 方案选择

推荐方案：新增 `WS /ws/sessions/{session_id}/voice` 作为语音侧链路。

原因：

- 不破坏现有 `POST /sessions/{session_id}/messages` 合同，前端消息展示仍按 Message Service v2 返回。
- 语音播放事件天然是异步的，WebSocket 比轮询更适合 `audio_ready`、`done`、`cancelled`。
- 后端可以统一处理 Voice Workflow TTS 的外部 URL、取消语义和 trace。

备选方案 A：把实时语音塞进 `POST /sessions/{session_id}/messages/realtime`。

- 优点：一个入口能同时处理文本和语音。
- 缺点：会把消息生成、TTS chunk、播放进度混在一个请求模型里，前端打断和服务端取消更难做。

备选方案 B：前端直接调用 Voice Workflow TTS chunk API。

- 优点：链路短。
- 缺点：绕开权限、trace、代理和服务边界；不符合当前拓扑约束，不采用。

## 5. 总体架构

新增后目标链路：

```text
POST /sessions/{session_id}/messages
  -> FastAPI OpenClawStreamAdapter
  -> OpenClaw Gateway WebSocket / session stream events
  -> adapter 归一化为 text delta
  -> FastAPI sentence buffer 凑句
  -> session voice job queue 按 message/job 顺序排队
  -> VoiceWorkflowTtsClient.synthesize_chunk()
  -> Voice Workflow TTS /api/v1/tts/chunk
  -> FastAPI 推送 audio_ready(job_id, sequence, proxy_url)
  -> Frontend AudioQueue 按 message/job/sequence 顺序播放
  -> SpeakingState 驱动 MMDStage
```

长任务 TTS 仍保留：

```text
POST /sessions/{session_id}/messages with tts_enabled=true
  -> Voice Workflow TTS /api/v1/tts
  -> message_tts
  -> /tts/proxy/{tts_id}
```

建议 Phase 1 请求消息时仍允许 `tts_enabled=true`，让长任务 TTS 作为兜底；实时语音成功播放时，不要求立即写入 `message_tts`。

## 6. 后端需求拆解

### 6.1 配置

新增配置建议：

```env
REALTIME_VOICE_ENABLED=true
REALTIME_VOICE_MAX_CHARS=25
REALTIME_VOICE_MIN_SEGMENT_CHARS=10
REALTIME_VOICE_MAX_SEGMENTS=24
REALTIME_VOICE_CHUNK_TIMEOUT_SECONDS=30
REALTIME_VOICE_MAX_QUEUE_SIZE=16
REALTIME_VOICE_WORKERS_PER_SESSION=1
REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD=5
REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS=60
REALTIME_VOICE_CIRCUIT_OPEN_SECONDS=120
REALTIME_VOICE_MAX_QUEUE_WAIT_SECONDS=120
OPENCLAW_STREAM_MODE=gateway_ws
OPENCLAW_STREAM_RAW_LOG_ENABLED=false
```

约束：

- `TTS_SERVICE_ENABLED=false` 时，实时语音 WebSocket 应返回明确错误事件，前端降级。
- 当前 OpenClaw 配置不变：`OPENCLAW_MODEL=openclaw`，`OPENCLAW_AGENT_ID=gpt-5-4`，`OPENCLAW_MESSAGE_CHANNEL=feishu`。
- 真 streaming 的外部接入方式优先使用 OpenClaw Gateway WebSocket 事件；HTTP SSE `stream=true` 只能作为未来可选模式。

涉及文件：

- 修改 `api/app/config.py`

### 6.2 OpenClaw stream adapter

新增 OpenClaw streaming 适配层，统一屏蔽 Gateway WebSocket、未来 SSE adapter、非流式 fallback 的差异。

推荐接口：

```python
class OpenClawTextDelta(TypedDict):
    type: Literal["delta", "completed", "error"]
    delta: str | None
    final_text: str | None
    raw_event: dict[str, Any] | None

async def stream_reply(
    *,
    user_id: str,
    session_id: str,
    message: str,
    history: list[dict[str, str]],
) -> AsyncIterator[OpenClawTextDelta]:
    ...
```

接入优先级：

1. `gateway_ws`：通过 OpenClaw Gateway WebSocket / session event 消费文本增量。需要和 OpenClaw 对齐 event schema、订阅方法、session key 和 final event。
2. `gateway_sse_adapter`：如果 Gateway 事件只能由内部命令或 SDK 消费，本项目可包一层 adapter，把 Gateway/session 事件转成 FastAPI 内部 async iterator 或 SSE。
3. `http_sse`：只有 OpenClaw 明确暴露公开 HTTP SSE 合同时才启用，不作为 Phase 1 默认假设。
4. `final_only`：保底模式，复用当前 `/v1/responses` 最终结果；可生成短句 chunk，但不算真 streaming。

说明：

- OpenClaw 的 `--raw-stream` / `--raw-stream-path` 适合作为诊断和原始事件留档，不应作为浏览器播放链路的运行时依赖。
- `--expect-final` 能拿最终结果，但不能满足 token-by-token 或 delta-by-delta 的实时语音启动需求。
- adapter 必须输出统一的 `delta/completed/error`，后续 sentence buffer 只依赖这个统一事件。
- trace 需要保存 `openclaw.stream.mode`、`openclaw.stream.first_delta_ms`、`openclaw.stream.completed_ms`、`openclaw.stream.raw_event_type`。

涉及文件建议：

- 新增或扩展 `api/app/services/openclaw_stream_adapter.py`
- 扩展 `api/app/services/openclaw_client.py`
- 新增 `api/tests/test_openclaw_stream_adapter.py`

### 6.3 TTS chunk client

扩展 `VoiceWorkflowTtsClient`：

```python
async def synthesize_chunk(
    self,
    *,
    text: str,
    emotion_label: str | None,
    session_id: str,
    sequence: int,
) -> dict:
    ...

async def cancel_realtime(self, session_id: str) -> dict:
    ...
```

行为：

- `synthesize_chunk()` 调用 `{TTS_SERVICE_BASE_URL}/api/v1/tts/chunk`。
- `cancel_realtime()` 调用 `{TTS_SERVICE_BASE_URL}/api/v1/tts/realtime/{session_id}/cancel`。
- 返回值需要保留 `session_id`、`sequence`、`status`、`audio_url`、`duration`、`elapsed_seconds`。
- Voice 服务返回相对 `audio_url` 时，后端要能转换成绝对 URL 用于代理拉取。

涉及文件：

- 修改 `api/app/services/voice_workflow_tts_client.py`
- 新增或扩展 `api/tests/test_voice_workflow_tts_client.py`

### 6.4 分句器

新增纯函数：

```python
def split_assistant_text(text: str, max_chars: int = 25) -> list[str]:
    ...
```

规则：

- 优先按 `。！？!?` 收句。
- 当前段落超过最小长度后，可按 `，、；;：:` 软切。
- 超过 `max_chars` 必须硬切。
- 去除空白段。
- 保留标点，避免播放时语气断裂。

涉及文件建议：

- 新增 `api/app/services/realtime_voice.py`
- 新增 `api/tests/test_realtime_voice.py`

### 6.5 浏览器侧 WebSocket

新增路由：

```text
WS /ws/sessions/{session_id}/voice
```

前端发送：

```json
{
  "type": "synthesize",
  "text": "你好，我已经帮你整理好了。这个方案可以分三步处理。",
  "emotion_label": "日常平静",
  "message_id": "msg_assistant_1"
}
```

后端接受后先入队，不抢占当前正在生成或正在播放的语音任务：

```json
{
  "type": "queued",
  "session_id": "sess_1",
  "message_id": "msg_assistant_1",
  "job_id": "voice_job_1",
  "queue_position": 2
}
```

取消：

```json
{
  "type": "cancel",
  "scope": "current_job"
}
```

`scope` 可选值：

- `current_job`：取消当前正在生成的 voice job，不清空后续队列。
- `all`：取消当前 job 并清空当前 session 的 voice job queue。

后端事件：

```json
{ "type": "synthesis_started", "session_id": "sess_1", "message_id": "msg_assistant_1", "job_id": "voice_job_1" }
```

```json
{
  "type": "audio_ready",
  "session_id": "sess_1",
  "message_id": "msg_assistant_1",
  "job_id": "voice_job_1",
  "sequence": 1,
  "text": "你好，我已经帮你整理好了。",
  "audio_url": "/tts/proxy/realtime/sess_1/voice_job_1/0001",
  "duration": 1.2,
  "elapsed_seconds": 0.8
}
```

```json
{ "type": "done", "session_id": "sess_1", "message_id": "msg_assistant_1", "job_id": "voice_job_1" }
```

```json
{ "type": "cancelled", "session_id": "sess_1", "message_id": "msg_assistant_1", "job_id": "voice_job_1", "scope": "current_job" }
```

```json
{
  "type": "error",
  "session_id": "sess_1",
  "message_id": "msg_assistant_1",
  "detail": "Voice workflow TTS chunk failed."
}
```

后端语义：

- 同一 session 内维护 voice job queue；新的 `synthesize` 默认入队，不取消旧任务。
- 默认 `REALTIME_VOICE_WORKERS_PER_SESSION=1`，同一 session 内按 message/job 顺序异步生成，避免角色连续说话时乱序。
- 每个 job 内按 sequence 顺序请求 chunk；如果后续需要并发生成，发给前端的 `job_id + sequence` 必须仍可排序。
- 收到 `cancel` 后按 `scope` 停止当前 job 或清空全部队列，调用 Voice Workflow TTS cancel API，并推送 `cancelled`。
- WebSocket 断开时不立即取消已经入队的 job；后端可继续完成当前队列并保留短期代理映射。若 session 被显式关闭或收到 `cancel(scope=all)`，才清空队列。
- 用户权限应沿用 Message Service v2 的 `x-user-id` 模型。WebSocket 无法稳定带自定义 header 时，前端可通过 query 参数或首个 auth message 传递 user id；实现前必须选择一种并写入拓扑文档。

涉及文件：

- 新增 `api/app/routes/realtime_voice.py`
- 修改 `api/app/main.py` 注册 router
- 新增 WebSocket 测试

### 6.6 chunk 音频代理

新增代理：

```text
GET /tts/proxy/realtime/{session_id}/{job_id}/{sequence}
```

要求：

- 浏览器拿到的是本项目 URL，不拿 Voice Workflow TTS 原始 URL。
- 后端根据 active realtime chunk registry 或 trace payload 找到远端 `audio_url`。
- 返回 `Content-Type: audio/wav` 或远端返回的 media type。
- 远端 404/410 时返回对应错误，并写 trace。

Phase 1 可使用内存 registry：

```text
session_id + job_id + sequence -> remote_audio_url, media_type, message_id, created_at
```

如果需要刷新后重播 chunk，再新增 SQLite 表；Phase 1 不要求。

### 6.7 trace

新增 trace stage：

```text
voice.realtime.started
voice.realtime.queued
voice.realtime.dequeued
voice.realtime.chunk_requested
voice.realtime.chunk_ready
voice.realtime.chunk_failed
voice.realtime.circuit_opened
voice.realtime.circuit_half_open
voice.realtime.circuit_closed
voice.realtime.cancelled
voice.realtime.done
voice.realtime.proxy
```

必须记录：

- `trace_id`
- `user_id`
- `session_id`
- `message_id`
- `job_id`
- `sequence`
- `queue_position`
- `queue_wait_ms`
- `circuit_state`
- `circuit_reason`
- `text_length`
- `emotion_label`
- `remote_audio_url`，可脱敏但要能排查
- `elapsed_ms`
- `first_audio_ready_ms`
- `openclaw_stream_mode`
- `openclaw_first_delta_ms`

### 6.8 熔断和限流

实时语音必须有熔断机制，避免 OpenClaw streaming、Voice Workflow TTS 或浏览器播放异常时继续堆积队列。

后端熔断状态：

```text
closed    正常接收和处理 voice job
open      暂停实时语音，新的 job 直接返回 rejected/fallback
half_open 熔断窗口结束后，只允许一个探测 job
```

触发条件：

- 同一 session 的 voice job 数量超过 `REALTIME_VOICE_MAX_QUEUE_SIZE`。
- 任一 job 的排队等待超过 `REALTIME_VOICE_MAX_QUEUE_WAIT_SECONDS`。
- `REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS` 窗口内，TTS chunk 连续失败或超时达到 `REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD`。
- OpenClaw stream 在短时间内连续断流、无 delta 超时或返回协议错误。
- realtime proxy 连续返回远端 404/410/5xx，说明 chunk registry 或 Voice 服务状态不可用。

熔断行为：

- 后端推送：

```json
{
  "type": "rejected",
  "reason": "circuit_open",
  "fallback": "message_tts",
  "retry_after_seconds": 120
}
```

- 新 job 不再进入 realtime queue。
- 当前正在播放的前端 AudioQueue 不被强制停止；已经 ready 的 chunk 可以播完。
- 未开始生成的 queued job 标记为 `rejected`，前端降级到现有长任务 TTS。
- 熔断窗口结束后进入 `half_open`，只允许一个探测 job；探测成功后恢复 `closed`，失败则重新 `open`。

前端播放熔断：

- 单个 job 内连续 2 个 chunk 播放失败，跳过该 job 的剩余 chunk，进入 fallback。
- 全局连续 3 个 job 播放失败，当前 session 的 realtime voice 标记为 disabled，直到用户刷新或手动重试。
- 前端不得因为播放失败反复重新 enqueue 同一个 audio URL。

trace 必须记录熔断状态变化和 rejected job，便于定位瓶颈在 OpenClaw、TTS、API proxy 还是浏览器播放。

## 7. 前端需求拆解

### 7.1 WebSocket URL helper

在 `web/src/lib/api.ts` 新增：

```ts
export function sessionVoiceWebSocketUrl(sessionId: string, userId: string): string;
```

要求：

- 浏览器环境下使用当前 origin 推导 `ws://` 或 `wss://`。
- 保持和 `/api/backend/*` 代理一致的部署假设。
- user id 传递方式要和后端 WebSocket 权限方案一致。

### 7.2 AudioQueue

新增：

```text
web/src/lib/audioQueue.ts
```

接口：

```ts
export type AudioQueueItem = {
  messageId?: string;
  jobId?: string;
  sequence: number;
  url: string;
  text?: string;
};

export type AudioQueueEvents = {
  onBuffering?: () => void;
  onPlay?: (item: AudioQueueItem) => void;
  onEnded?: (item: AudioQueueItem) => void;
  onError?: (item: AudioQueueItem, error: unknown) => void;
  onIdle?: () => void;
};

export class AudioQueue {
  enqueue(item: AudioQueueItem): void;
  stop(): void;
  reset(): void;
  isPlaying(): boolean;
  size(): number;
}
```

行为：

- 按 `sequence` 排序播放。
- 跨 message/job 时，先按入队顺序播放 job，再按 `sequence` 播放 chunk。
- 同一时间只允许一个 `Audio` 播放。
- 第一段到达后自动播放。
- 某段加载失败时触发 `onError`，继续后续段。
- `stop()` 立即 pause 当前音频、清空队列、触发 idle/cancel 相关回调。

### 7.3 Companion 页面集成

当前 `web/src/app/companion/page.tsx` 已有：

- `speaking:boolean`
- `serverAudioRef`
- `stopSpeechPlayback()`
- `prepareAndPlayAssistantTts()`
- `playRemoteServerAudio()`

新增实时语音后要求：

- 新增 `SpeakingState` state，`speaking` 由它派生。
- 新增 `voiceSocketRef` 和 `audioQueueRef`。
- assistant message 返回后，如果 `ttsEnabled && ttsMode === "server"` 且 realtime enabled，则优先走 voice WebSocket。
- 收到 `audio_ready` 后 enqueue。
- 用户再次发送消息时，不默认停止当前 realtime AudioQueue，也不默认 cancel 后端 job；新的 assistant voice job 进入 session queue 异步等待。
- 用户显式点击“停止/清空语音”或切换会话时，必须：
  - 停止浏览器 `speechSynthesis`
  - 停止长任务 server audio
  - 停止 realtime AudioQueue
  - 向 voice WebSocket 发送 `cancel(scope=all)`
- realtime WebSocket 失败、chunk 失败或播放失败时，降级到现有 `prepareAndPlayAssistantTts()`。

### 7.4 Chatbox 状态

当前 Chatbox 的语音按钮依赖 `message.tts.status === "ready"`。实时语音不是 message-level ready 状态，需要新增轻量状态展示：

```ts
type RealtimeVoiceStatus =
  | "idle"
  | "buffering"
  | "playing"
  | "cancelled"
  | "rejected"
  | "circuit_open"
  | "failed"
  | "fallback";
```

Phase 1 最小要求：

- 最新 assistant message 的实时语音播放中，按钮显示 active/playing。
- realtime 熔断时，最新 assistant message 显示 fallback/rejected 状态，但不污染 `message.tts.status`。
- cancelled 或 failed 后不污染 `message.tts.status`。
- fallback 到长任务 TTS 时，沿用现有 `message.tts` UI。

## 8. MMD 舞台需求拆解

新增类型：

```ts
export type SpeakingState =
  | { state: "idle" }
  | { state: "buffering"; sessionId: string; messageId?: string }
  | { state: "speaking"; sessionId: string; messageId?: string; sequence: number; text?: string }
  | { state: "ended"; sessionId: string; messageId?: string }
  | { state: "cancelled"; sessionId: string; messageId?: string }
  | { state: "error"; sessionId: string; messageId?: string; detail: string };
```

Phase 1：

- `MMDStage` 可以继续接收 `speaking:boolean`。
- `CompanionPage` 使用 `speakingState.state === "speaking"` 派生 boolean。
- `buffering` 不触发口型，但可用于 UI 状态。
- `cancelled`、`ended`、`error` 必须停止口型。

Phase 2：

- `MMDStage` 接收完整 `speakingState`。
- `mmdCompanionRuntime.setSpeaking()` 可扩展为 `setSpeakingState()`。
- 若后续 Voice Workflow TTS 提供 viseme/phoneme/timing，可按 `sequence` 和播放时间驱动更准确口型。

## 9. 数据和持久化

Phase 1 不新增强持久化表：

- `messages` 仍保存 assistant 文本、emotion、action、motion plan。
- `message_tts` 仍保存长任务 TTS fallback。
- realtime chunk 只写 trace，并使用内存 registry 支撑代理。

只有在需要“刷新后继续播放实时 chunk”或“历史消息逐 chunk 重播”时，再新增：

```text
message_tts_chunks
  id
  workspace_id
  message_id
  session_id
  sequence
  text
  remote_audio_url
  proxy_audio_url
  media_type
  duration_seconds
  status
  error
  created_at
  completed_at
```

## 10. 端到端行为

### 10.1 正常播放

```text
User sends message
  -> stop current voice
  -> POST /sessions/{id}/messages
  -> assistant text rendered
  -> voice WS synthesize(text, emotion_label)
  -> synthesis_started -> SpeakingState.buffering
  -> audio_ready #1 -> AudioQueue enqueue -> SpeakingState.speaking
  -> audio_ready #2..N -> queue plays in order
  -> done + queue empty -> SpeakingState.ended -> idle
```

### 10.2 新消息排队

```text
User sends another message
  -> current audio keeps playing
  -> POST /sessions/{id}/messages starts next assistant reply
  -> voice WS synthesize(next assistant text/deltas)
  -> backend enqueues next voice job
  -> current job finishes first
  -> next job starts synthesis/playback in queue order
```

### 10.3 显式停止/清空

```text
User clicks stop/clear voice
  -> AudioQueue.stop()
  -> voice WS cancel(scope=all)
  -> backend cancel_realtime(session_id)
  -> backend clears queued voice jobs
  -> frontend SpeakingState.cancelled -> idle
```

### 10.4 实时失败降级

```text
voice WS error / chunk failed / playback failed
  -> SpeakingState.error
  -> trace voice.realtime.chunk_failed
  -> fallback prepareAndPlayAssistantTts()
  -> existing message_tts ready/pending/failed flow
```

### 10.5 熔断降级

```text
TTS chunk timeouts / queue overflow / repeated playback errors
  -> backend opens realtime voice circuit
  -> new voice jobs receive rejected(circuit_open)
  -> frontend marks realtime voice fallback
  -> existing message_tts path continues
  -> circuit half-open after cooldown
  -> one probe job succeeds -> circuit closed
```

## 11. 验收标准

- 发送用户消息后，assistant 文本展示行为不回退。
- realtime voice enabled 时，第一段音频在后续段仍在生成时即可开始播放。
- 同一 job 内所有 chunk 按 `sequence` 顺序播放；跨 job 按入队顺序播放，不重叠。
- 发送下一条用户消息不会默认取消当前语音；新的 voice job 进入 session queue 异步生成。
- 用户显式停止/清空语音时，会停止当前音频、清空队列，并触发后端 `cancel(scope=all)`。
- 队列过长、连续 chunk 失败或播放错误率过高时会触发 realtime voice 熔断，后续 job 降级到长任务 TTS。
- realtime 失败时，现有长任务 TTS 仍可播放。
- MMD 口型只在实际音频播放时开启，ended/cancelled/error 后关闭。
- trace 能区分 OpenClaw 文本耗时、queue wait、TTS chunk 耗时、首段 ready 耗时和取消事件。

## 12. 测试计划

后端：

- `OpenClawStreamAdapter` 覆盖 Gateway WebSocket delta、completed、error、断流和 final_only fallback。
- `split_assistant_text()` 覆盖中文句号、逗号软切、英文标点、硬切、空白输入。
- `VoiceWorkflowTtsClient.synthesize_chunk()` 覆盖相对/绝对 `audio_url`、非 2xx、缺字段。
- WebSocket 覆盖 `synthesize -> audio_ready -> done`。
- WebSocket 覆盖连续 `synthesize` 时按 voice job queue 顺序生成。
- WebSocket 覆盖 `cancel(scope=current_job)` 只取消当前 job。
- WebSocket 覆盖 `cancel(scope=all)` 清空当前 session 队列。
- WebSocket 覆盖 queue overflow 返回 `rejected(circuit_open | queue_full)`。
- 熔断测试覆盖 closed -> open -> half_open -> closed。
- realtime proxy 覆盖成功、远端 404/410、远端 502。
- trace 覆盖 queued、dequeued、started、chunk_ready、circuit_opened、cancelled、done。

前端：

- `AudioQueue` 覆盖乱序 enqueue 后按序播放。
- `AudioQueue.stop()` 覆盖当前 audio 被 pause 且队列清空。
- `sessionVoiceWebSocketUrl()` 覆盖 http/https 到 ws/wss。
- `CompanionPage` 覆盖新消息不会调用 stop/cancel，而是发送新的 synthesize 入队。
- `CompanionPage` 覆盖显式停止/切换会话调用 stop/cancel(scope=all)。
- `CompanionPage` 覆盖 `rejected(circuit_open)` 时进入长任务 TTS fallback。
- `AudioQueue` 覆盖连续播放失败后停止当前 job，避免重复 enqueue。
- realtime 失败时调用现有 fallback TTS 路径。

手工联调：

- Voice Workflow TTS chunk API 返回可播放 WAV。
- FastAPI realtime proxy 可在浏览器播放。
- Companion 页面首次 chunk 播放时 MMD 开口型。
- 连续快速发送两条消息，无音频重叠。

## 13. 风险和待确认

- Qwen3-TTS CPU 推理可能仍然太慢，音频侧短句 chunk 播放的体感收益取决于 chunk API 延迟。
- 如果没有熔断，异步队列会在 TTS 慢或失败时持续积压；因此 realtime voice 必须先实现 queue limit、timeout 和 circuit breaker。
- Voice Workflow TTS cancel 不能中断正在跑的模型调用，只能丢弃结果；该能力只用于显式停止/清空队列，不作为新消息默认行为。
- WebSocket 的 user id 传递方式需要实现前确定，避免绕开 Message Service v2 权限模型。
- 真文本 streaming 依赖 OpenClaw Gateway 提供可外部消费的 session stream event schema，或本项目实现 Gateway/session event adapter；不能假设已有公开 HTTP SSE。
- 内存 registry 在服务重启后会丢 realtime chunk 代理映射；Phase 1 可接受，历史重播依赖长任务 TTS。

## 14. 实施阶段

Phase 1：后端基础

- 配置项
- `synthesize_chunk()` / `cancel_realtime()`
- 分句器
- OpenClaw Gateway stream adapter 和 sentence buffer
- session voice job queue
- realtime voice 熔断和限流
- realtime voice WebSocket
- realtime proxy
- trace

Phase 2：前端播放

- `AudioQueue`
- WebSocket URL helper
- CompanionPage 集成
- 新消息入队生成
- 显式停止/清空队列
- fallback 到现有 TTS

Phase 3：MMD 状态演进

- `SpeakingState`
- boolean 派生
- 后续扩展 `MMDStage` 接收完整状态

Phase 4：OpenClaw streaming 增强

- 如果 OpenClaw 后续公开 HTTP SSE 或 OpenAI-compatible `stream=true` 合同，可作为 `OpenClawStreamAdapter` 的新增 mode。
- 如 OpenClaw Gateway 暴露更完整的 timing/raw event metadata，同步扩展 trace 和熔断判断。

## 15. 文档维护要求

实现本文任一功能时，如果改变了服务拓扑、API、环境变量、trace stage、数据落点或运行时行为，必须同步更新：

- `docs/architecture/current-system-topology.md`

如果实现拆成工程任务，应另建 implementation plan：

- `docs/plans/YYYY-MM-DD-mmd-realtime-voice-implementation.md`

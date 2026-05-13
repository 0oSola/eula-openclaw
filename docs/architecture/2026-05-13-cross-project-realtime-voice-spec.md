# Cross-Project Realtime Voice Spec

## Goal

Add realtime-feeling voice output to the virtual assistant system while preserving the current Qwen3-TTS `.pt` cloned voice and the existing task-based TTS fallback.

The system should play the first short audio segment as soon as it is ready, continue playing later segments in order, queue later assistant voice jobs asynchronously, and support explicit user interruption.

## Current System Boundary

From `/Users/sola/Downloads/current-system-topology.md`:

```text
Browser / Next.js UI
  -> Next.js backend proxy /api/backend/*
    -> Virtual Assistant FastAPI API
      -> OpenClaw Gateway HTTP/WebSocket
      -> Voice Workflow TTS
      -> SQLite + NDJSON
      -> Local MMD/VMD files
```

Current voice flow:

```text
Virtual Assistant API
  -> POST Voice Workflow TTS /api/v1/tts
  -> poll /api/v1/tasks/{task_id}
  -> save remote_audio_url
  -> frontend fetches /tts/proxy/{tts_id}
```

This is not realtime because it waits for a full TTS task to complete.

## Target System Shape

Add a second voice path:

```text
OpenClaw HTTP SSE text delta or Gateway WebSocket text delta
  -> Virtual Assistant API sentence buffer
  -> Virtual Assistant API session voice job queue
  -> Voice Workflow TTS short chunk API
  -> Virtual Assistant API WebSocket event
  -> Next.js frontend AudioQueue
  -> MMD speaking state
```

True text streaming means the Virtual Assistant consumes OpenClaw text delta events before the final assistant text is complete. The verified default path is `/v1/responses stream=true` with `model=openclaw`, which follows OpenClaw's current default agent/model. Gateway WebSocket agent events are also supported and can be used as an adapter mode. A final-text-only fallback may still generate short audio chunks, but it does not satisfy true streaming acceptance.

The current task-based path remains:

```text
POST /api/v1/tts
GET /api/v1/tasks/{task_id}
GET /api/v1/audio/{path}
```

## Non-Goals

- Do not replace Qwen3-TTS `.pt` voice cloning.
- Do not require browser direct access to the Voice Workflow TTS service.
- Do not depend on OpenClaw `/v1/audio/speech`; topology says it currently returns 404.
- Do not claim true model-level audio streaming from Qwen3-TTS Base. The first implementation is short-utterance pseudo-streaming.
- Do not pin realtime voice to a specific OpenClaw agent unless a future feature explicitly requires it.

---

# 1. Voice Workflow TTS Project

Project:

```text
/Users/sola/Desktop/kscc/Qwen3-TTS/voice-workflow-service
```

## Responsibilities

The Voice project owns:

- Qwen3-TTS model process.
- `.pt` voice prompt mapping and caching.
- Short utterance synthesis.
- Session cancellation flags.
- Audio file generation and serving.
- TTS-specific timing metadata.

The Voice project does not own:

- OpenClaw text generation.
- Browser-facing session state.
- SQLite message persistence in the virtual assistant.
- MMD playback or lip-sync.

## Required Changes

### 1.1 Add realtime config

Add settings:

```env
VWS_PRELOAD_TTS_MODEL=false
VWS_PRELOAD_PROMPT_LABELS=日常平静
VWS_WARMUP_TTS_ON_STARTUP=false
VWS_WARMUP_TEXT=你好。
VWS_REALTIME_MAX_CHARS=25
VWS_REALTIME_MIN_NEW_TOKENS=128
VWS_REALTIME_OUTPUT_SUBTYPE=FLOAT
```

Default device should stay `cpu` unless deployment has usable CUDA or MPS:

```env
VWS_TTS_DEVICE=cpu
```

Production realtime should use GPU if available.

### 1.2 Add short chunk API

Endpoint:

```text
POST /api/v1/tts/chunk
```

Request:

```json
{
  "text": "这是实时语音测试。",
  "emotion_label": "日常平静",
  "session_id": "session-1",
  "sequence": 1,
  "lang": "Auto"
}
```

Response:

```json
{
  "session_id": "session-1",
  "sequence": 1,
  "status": "ready",
  "audio_url": "/api/v1/audio/realtime/session-1/0001.wav",
  "duration": 1.2,
  "elapsed_seconds": 0.8,
  "max_new_tokens": 128,
  "emotion_label": "日常平静"
}
```

Behavior:

- Use cached Qwen3-TTS model.
- Use cached `.pt` voice prompt.
- Use realtime token budget.
- Write WAV as `FLOAT`.
- Return `status=cancelled` if the session was cancelled before returning.

### 1.3 Add cancel API

Endpoint:

```text
POST /api/v1/tts/realtime/{session_id}/cancel
```

Response:

```json
{
  "session_id": "session-1",
  "cancelled": true
}
```

Behavior:

- Mark session cancelled.
- Do not try to forcibly kill an in-flight model call.
- Drop the in-flight result after generation if cancelled.
- Drop queued future work for that session.

This API is for explicit stop/clear behavior. A new assistant message should normally create a new queued voice job instead of calling cancel by default.

### 1.4 Add startup warmup

If enabled:

1. Load Qwen3-TTS model.
2. Load configured prompt labels.
3. Synthesize one short warmup sentence.

This reduces first-user-message latency.

### 1.5 Keep long-form API stable

Do not break:

```text
POST /api/v1/tts
GET /api/v1/tasks/{task_id}
GET /api/v1/audio/{path}
GET /api/v1/emotions
```

Existing virtual assistant fallback depends on these.

## Voice Project Acceptance Criteria

1. `POST /api/v1/tts/chunk` returns a playable WAV URL.
2. Generated WAV is `24000 Hz`, mono, `FLOAT`.
3. `POST /api/v1/tts/realtime/{session_id}/cancel` returns `cancelled=true`.
4. Existing `/api/v1/tts` long-form task path still works.
5. `GET /admin/tts-cache` shows model and prompt cache state.
6. Realtime chunk response includes `elapsed_seconds` and `max_new_tokens`.

---

# 2. Virtual Assistant Project

Project described by topology:

```text
api/
web/
```

This project includes both backend and frontend.

## Backend Responsibilities

The virtual assistant backend owns:

- Browser-facing API/WebSocket.
- OpenClaw call orchestration.
- Sentence buffering/splitting.
- Calling Voice Workflow TTS short chunk API.
- Converting remote TTS audio URLs into frontend-safe proxy URLs.
- SQLite and trace persistence.
- Cancel semantics across OpenClaw/TTS/frontend.

## Frontend Responsibilities

The virtual assistant frontend owns:

- Chatbox UX.
- Realtime voice WebSocket connection.
- Ordered audio playback queue.
- User interruption behavior.
- MMD speaking/lip-sync state hooks.
- Fallback to existing task-based TTS playback.

## Required Backend Changes

### 2.1 Add TTS short chunk client

Extend the existing `VoiceWorkflowTtsClient`.

New method:

```python
async def synthesize_chunk(
    self,
    text: str,
    emotion_label: str,
    session_id: str,
    sequence: int,
) -> dict:
    ...
```

It calls:

```text
POST {TTS_SERVICE_BASE_URL}/api/v1/tts/chunk
```

Add cancel method:

```python
async def cancel_realtime(self, session_id: str) -> dict:
    ...
```

It calls:

```text
POST {TTS_SERVICE_BASE_URL}/api/v1/tts/realtime/{session_id}/cancel
```

### 2.2 Add sentence splitter

Create a backend utility:

```python
def split_assistant_text(text: str, max_chars: int = 25) -> list[str]:
    ...
```

Rules:

- Prefer `。！？!?`.
- Allow split on `，,、；;：:` when current segment is at least 10 chars.
- Hard split at `max_chars`.
- Remove empty segments.

Example:

```python
split_assistant_text(
    "你好，我已经帮你查到了。这个方案可以分三步处理。",
    max_chars=25,
)
```

Expected:

```python
[
    "你好，我已经帮你查到了。",
    "这个方案可以分三步处理。",
]
```

### 2.3 Add browser-facing realtime voice WebSocket

Endpoint:

```text
WS /ws/sessions/{session_id}/voice
```

Frontend sends:

```json
{
  "type": "synthesize",
  "job_id": "voice-job-1",
  "message_id": "assistant-message-1",
  "text": "你好，我已经帮你查到了。这个方案可以分三步处理。",
  "emotion_label": "日常平静"
}
```

Multiple `synthesize` messages for the same `session_id` are queued in receive order. The backend should process one voice job at a time per session, while allowing future jobs to wait without cancelling the current one.

Frontend cancels:

```json
{
  "type": "cancel",
  "scope": "all"
}
```

Supported cancel scopes:

- `current_job`: cancel the current generating/playing voice job and keep later queued jobs.
- `all`: stop current work and clear the session voice queue.

Backend sends:

```json
{
  "type": "synthesis_started",
  "session_id": "session-1",
  "job_id": "voice-job-1"
}
```

```json
{
  "type": "audio_ready",
  "job_id": "voice-job-1",
  "sequence": 1,
  "text": "你好，我已经帮你查到了。",
  "audio_url": "/tts/proxy/realtime/session-1/voice-job-1/0001",
  "duration": 1.2,
  "elapsed_seconds": 0.8
}
```

```json
{
  "type": "done",
  "session_id": "session-1",
  "job_id": "voice-job-1"
}
```

```json
{
  "type": "cancelled",
  "session_id": "session-1",
  "job_id": "voice-job-1",
  "scope": "all"
}
```

```json
{
  "type": "rejected",
  "session_id": "session-1",
  "job_id": "voice-job-9",
  "reason": "queue_full",
  "fallback": "message_tts"
}
```

Fallback and duplicate playback policy:

- Track whether the frontend has started playing any chunk for each `job_id`.
- If a realtime job fails before any chunk for that job has played, automatically fall back to the existing full `message_tts` audio.
- If at least one chunk has already played and the same job later fails, mark the realtime job `partial_failed` and expose manual replay for the full `message_tts` audio instead of auto-playing it.
- `rejected(queue_full|circuit_open, fallback=message_tts)` may still auto-fallback because no realtime chunk has played for that rejected job.
- Do not enqueue the same fallback audio repeatedly for repeated WebSocket, chunk, or playback errors.

### 2.4 Proxy audio URLs

The Voice service may return:

```text
/api/v1/audio/realtime/session-1/0001.wav
```

The browser should not fetch Voice Workflow TTS directly. The virtual assistant backend must expose a proxy URL, for example:

```text
/tts/proxy/realtime/{session_id}/{job_id}/{sequence}
```

or reuse existing `message_tts` proxy infrastructure if it can store chunk references.

The backend should fetch:

```text
{TTS_SERVICE_BASE_URL}/api/v1/audio/realtime/session-1/0001.wav
```

and return:

```text
Content-Type: audio/wav
```

### 2.5 Persistence and trace

At minimum, write trace events for:

- `voice.realtime.queued`
- `voice.realtime.dequeued`
- `voice.realtime.started`
- `voice.realtime.chunk_requested`
- `voice.realtime.chunk_ready`
- `voice.realtime.chunk_failed`
- `voice.realtime.partial_failed`
- `voice.realtime.cancelled`
- `voice.realtime.rejected`
- `voice.realtime.circuit_opened`
- `voice.realtime.circuit_half_open`
- `voice.realtime.circuit_closed`
- `voice.realtime.done`

If schema work is acceptable, add per-chunk rows. If not, first version can store chunk state in trace only and leave final message-level `tts.status` as current behavior.

### 2.6 Integrate with message flow

Do not replace current:

```text
POST /sessions/{session_id}/messages
```

Add realtime mode as either:

```text
WS /ws/sessions/{session_id}/voice
```

or a companion endpoint:

```text
POST /sessions/{session_id}/messages/realtime
```

The preferred implementation consumes `/v1/responses stream=true` through an `OpenClawStreamAdapter`, buffers `response.output_text.delta` into sentence chunks, and starts TTS before the final assistant text is complete.

Gateway WebSocket agent events remain a secondary adapter mode. If both streaming modes are unavailable, the backend may fall back to the existing final-text `/v1/responses` result, split it, and request chunk TTS. That fallback preserves playback behavior but does not satisfy true text streaming acceptance.

## Required Frontend Changes

### 2.7 Add audio queue

Create:

```text
web/src/lib/audioQueue.ts
```

Required API:

```ts
export type AudioQueueItem = {
  jobId: string;
  sequence: number;
  url: string;
  text?: string;
};

export class AudioQueue {
  enqueue(item: AudioQueueItem): void;
  stop(): void;
  reset(): void;
  isPlaying(): boolean;
  size(): number;
}
```

Behavior:

- Sort by queued `jobId` order, then by `sequence` within each job.
- Play one item at a time.
- Start automatically when first item arrives.
- Skip failed item and continue.
- `stop()` immediately stops current audio and clears queue.

### 2.8 Add realtime voice client

Add WebSocket URL helper in:

```text
web/src/lib/api.ts
```

Expected:

```ts
export function sessionVoiceWebSocketUrl(sessionId: string, userId: string): string;
```

It must follow existing Next.js proxy conventions and encode the user identity as a query parameter:

```text
WS /ws/sessions/{session_id}/voice?user_id={user_id}
```

The backend maps `user_id` to the same authorization model used by Message Service v2's `x-user-id`. Missing, empty, or unauthorized `user_id` must reject the WebSocket before accepting `synthesize`.

### 2.9 Update Chatbox/session component

Behavior:

1. On assistant reply ready, send `synthesize` over voice WebSocket if realtime voice is enabled.
2. On each `audio_ready`, enqueue audio.
3. On user new message:
   - keep existing playback unless the user explicitly stopped voice
   - send a new `synthesize` job after the next assistant reply is ready
   - let backend and frontend queues preserve non-overlapping order
4. On WebSocket failure:
   - fall back to existing `assistant_message.tts.proxy_audio_url` only if no realtime chunk for the current job has played
   - otherwise mark the job `partial_failed` and offer manual replay for the full audio
5. On explicit stop/clear:
   - stop queue
   - send `cancel(scope=all)`

### 2.10 Wire MMD speaking state

Expose state:

```ts
type SpeakingState =
  | { state: "idle" }
  | { state: "buffering"; sessionId: string }
  | { state: "speaking"; sessionId: string; sequence: number; text?: string }
  | { state: "ended"; sessionId: string }
  | { state: "cancelled"; sessionId: string }
  | { state: "error"; sessionId: string; detail: string };
```

MMD stage should:

- Start mouth movement when `speaking`.
- Stop mouth movement when `ended`, `cancelled`, or `error`.
- Keep existing idle/fallback motion behavior.

### 2.11 Add queue limits and circuit breaker

The Virtual Assistant backend owns session voice queue limits and realtime voice circuit state. This protects OpenClaw streaming, Voice Workflow TTS, proxying, and browser playback from uncontrolled backlog.

Suggested defaults:

```env
REALTIME_VOICE_MAX_QUEUE_SIZE=3
REALTIME_VOICE_CHUNK_TIMEOUT_SECONDS=30
REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD=5
REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS=60
REALTIME_VOICE_CIRCUIT_OPEN_SECONDS=120
```

Circuit states:

- `closed`: realtime jobs are accepted.
- `open`: new realtime jobs are rejected with `fallback=message_tts`.
- `half_open`: one probe job is allowed after cooldown; success closes the circuit, failure opens it again.

First-version scope is session-level only. Do not add global user-level or workspace-level realtime voice rate limiting in phase 1.

Events that count toward the session circuit window:

- `queue_full`: reject the current job immediately and count one circuit failure.
- `tts_chunk_timeout`: a chunk exceeds `REALTIME_VOICE_CHUNK_TIMEOUT_SECONDS`.
- `tts_chunk_failed`: Voice Workflow TTS returns non-2xx, malformed response, missing `audio_url`, or unreachable audio.
- `openclaw_stream_failed`: stream disconnects before completion, first delta times out, or the adapter sees an invalid event contract.
- `proxy_failed`: realtime audio proxy returns repeated 404/410/5xx for generated chunk URLs.
- `playback_failed`: frontend reports repeated audio load/play failures for a job.

Open the circuit when counted failures within `REALTIME_VOICE_CIRCUIT_WINDOW_SECONDS` reach `REALTIME_VOICE_CIRCUIT_FAILURE_THRESHOLD`. `queue_full` still returns `rejected(queue_full, fallback=message_tts)` even when the circuit remains closed.

When the circuit is open:

- Do not enqueue new realtime voice jobs.
- Return or send `rejected(circuit_open, fallback=message_tts)`.
- Keep the existing task-based TTS path available.
- Record trace events for state changes and rejected jobs.

## Virtual Assistant Acceptance Criteria

1. User sends message and assistant text appears as before.
2. With realtime voice enabled, first short audio segment starts before all voice segments are ready.
3. Audio segments play in job order and sequence order.
4. No overlapping audio.
5. Sending another user message queues a later voice job instead of cancelling the current one by default.
6. Explicit stop/clear stops current playback, clears the queue, and sends cancel.
7. Queue overflow, repeated failures, or repeated playback errors open the realtime voice circuit.
8. If realtime voice fails before any chunk has played or is rejected before playback starts, existing task-based TTS fallback still plays automatically.
9. If realtime voice fails after partial playback, the UI marks `partial_failed` and offers manual replay of the full task-based TTS audio without auto-playing a duplicate.
10. Trace logs show queue, chunk request/ready, cancel, reject, partial failure, and circuit timings.

---

# 3. OpenClaw

Service:

```text
OpenClaw Gateway HTTP  http://10.11.252.164:18789
OpenClaw Gateway WS    ws://10.11.252.164:18789
```

## Current Facts

From topology:

- Main text path uses `/v1/responses`.
- `payload.model = openclaw`.
- Realtime voice should follow the OpenClaw default route, currently `main` with the default model configured on the OpenClaw side.
- `x-openclaw-message-channel = feishu`.
- `/v1/audio/speech` currently returns 404.
- `/v1/responses stream=true` has been verified to return HTTP SSE events including `response.output_text.delta`.
- WebSocket RPC `agent` has been verified to return `agent stream=assistant` and `chat state=delta/final` events for `agentId=main`.
- OpenClaw runtime has internal streaming events and Gateway raw stream recording flags such as `--raw-stream` / `--raw-stream-path`.

## OpenClaw Responsibilities

OpenClaw owns:

- Text generation latency and stability.
- Optional text streaming support.
- Agent/channel/session semantics.

OpenClaw does not own:

- Qwen3-TTS `.pt` voice cloning.
- Browser audio playback.
- Voice Workflow TTS generation.

## Required OpenClaw Changes

### 3.1 Use `/v1/responses` HTTP SSE as the default stream

Default target:

```text
POST /v1/responses
model=openclaw
stream=true
```

Do not pin realtime voice to a business-specific agent unless the product explicitly needs it. `model=openclaw` with the default `main` route should follow OpenClaw's current default model.

Verified event shape:

```json
{
  "type": "response.output_text.delta",
  "item_id": "msg_...",
  "output_index": 0,
  "content_index": 0,
  "delta": "你好，"
}
```

Completion:

```json
{
  "type": "response.completed",
  "response": {
    "status": "completed"
  }
}
```

Error:

```json
{
  "type": "response.error",
  "error": {
    "message": "..."
  }
}
```

The adapter should consume `response.output_text.delta`, `response.output_text.done`, `response.completed`, `response.error`, and `[DONE]`, then normalize them to `delta/completed/error`.

### 3.2 Keep Gateway WebSocket as an adapter mode

Gateway WebSocket remains useful for sessions that need Gateway-native agent events:

```text
method=agent
agentId=main
```

Verified event shapes include:

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "stream": "assistant",
    "data": {
      "delta": "你好，"
    }
  }
}
```

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "state": "delta"
  }
}
```

Use this mode when the app needs Gateway session event semantics. Otherwise prefer HTTP SSE because it fits the existing `/v1/responses` message flow.

### 3.3 Preserve existing non-streaming contract

Do not break:

```text
POST /v1/responses
model=openclaw
x-openclaw-message-channel=feishu
```

Existing message flow depends on non-streaming response compatibility.

### 3.4 Expose timing metadata if available

Helpful but optional response metadata:

```json
{
  "timing": {
    "queue_ms": 10,
    "first_token_ms": 800,
    "total_ms": 2500
  }
}
```

Virtual assistant trace can use this to separate text latency from TTS latency.

### 3.5 Do not route voice through `/v1/audio/speech`

For this plan, voice remains in Voice Workflow TTS because:

- Current OpenClaw `/v1/audio/speech` is 404.
- Voice Workflow TTS preserves `.pt` cloned voice.

## OpenClaw Acceptance Criteria

Minimum:

1. Existing `/v1/responses` non-streaming behavior remains stable.
2. `/v1/responses stream=true` continues to emit `response.output_text.delta`.
3. `model=openclaw` follows the OpenClaw default route without pinning to a specific agent.
4. Gateway WebSocket adapter mode remains available for agent/session event use cases.

Nice-to-have:

1. First-token timing is exposed.
2. Completion/error events are explicit.
3. Raw stream logging can be enabled for diagnostics without becoming a runtime dependency for browser playback.

---

# Cross-Project Rollout Plan

## Phase 1: Voice Project Only

Deliver:

- `/api/v1/tts/chunk`
- `/api/v1/tts/realtime/{session_id}/cancel`
- warmup/preload settings

Test:

```bash
curl -X POST http://127.0.0.1:5555/api/v1/tts/chunk \
  -H "Content-Type: application/json" \
  -d '{"text":"\u8fd9\u662f\u5b9e\u65f6\u8bed\u97f3\u6d4b\u8bd5\u3002","emotion_label":"\u65e5\u5e38\u5e73\u9759","session_id":"smoke","sequence":1}'
```

Latest MMD-side retest against `http://10.11.252.164:5555` on 2026-05-13:

- Long task `POST /api/v1/tts`: `202` in 147ms, completed after 17 polls / 17.456s, returned `audio/wav` 184400 bytes with `RIFF` header.
- Chunk `POST /api/v1/tts/chunk`: short prompts returned `200` with response field `duration`; two sampled requests elapsed 14.992s / 14.687s, service `elapsed_seconds` 14.975 / 14.675, returned `audio/wav` 138320 bytes with `RIFF` header.
- This improves the older chunk baseline of about 22.7s request elapsed / service `elapsed_seconds=20.063`, but TTS remains the first-audio latency bottleneck for realtime voice.

Exit criteria:

- Returns playable WAV URL.
- Existing `/api/v1/tts` still works.

## Phase 2: Virtual Assistant Backend

Deliver:

- TTS chunk client
- sentence splitter
- OpenClaw `/v1/responses` HTTP SSE stream adapter
- optional OpenClaw Gateway WebSocket adapter
- session voice job queue
- realtime voice circuit breaker
- realtime voice WebSocket
- proxy URL for chunk audio
- trace events

Exit criteria:

- A WebSocket client receives `audio_ready` events in order.
- Consecutive synthesize requests are generated as queued jobs, not overlapping playback.
- Queue overflow or repeated failures return `rejected(..., fallback=message_tts)`.
- Browser-safe audio URLs can be fetched.

## Phase 3: Virtual Assistant Frontend

Deliver:

- `AudioQueue`
- voice WebSocket integration
- new message voice jobs enqueue behind current playback
- explicit stop/clear cancellation
- MMD speaking state integration
- fallback to existing TTS

Exit criteria:

- First segment plays before all segments are ready.
- New message does not interrupt current playback by default.
- Explicit stop interrupts current playback and clears queued voice.

## Phase 4: OpenClaw Streaming Hardening

Deliver:

- stable `/v1/responses stream=true` SSE contract
- Gateway WebSocket/session text delta contract for agent-event mode
- richer timing/raw event metadata if available

Exit criteria:

- TTS can start before full assistant reply is complete via HTTP SSE.
- `OpenClawStreamAdapter` can fall back to final text without breaking existing message flow.

---

# Key Risks

1. Qwen3-TTS Base does not provide true audio streaming from `generate_voice_clone`.
2. CPU inference remains too slow for production realtime; after optimization, short chunk generation still takes about 14.7-15.0s in the 2026-05-13 smoke test.
3. OpenClaw default route can change; this is intentional for default-following mode, but should be visible in trace.
4. Browser playback cannot directly fetch external TTS URLs unless proxied.
5. Cancel cannot interrupt an in-flight model call; it can only discard its result.
6. Without queue limits and circuit breaker, async generation can build an unbounded backlog.

# Required Metrics

Track these in trace:

```text
openclaw.first_text_ms
openclaw.total_text_ms
openclaw.stream_mode
voice.queue_wait_ms
tts.chunk.requested_at
tts.chunk.ready_at
tts.chunk.elapsed_ms
voice.first_audio_ready_ms
frontend.first_audio_play_ms
voice.cancelled_at
voice.partial_failed_at
voice.rejected_reason
voice.circuit_state
```

These metrics determine whether bottleneck is OpenClaw, Voice Workflow TTS, main API orchestration, or frontend playback.

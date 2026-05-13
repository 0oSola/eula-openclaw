# Cross-Project Realtime Voice Spec

## Goal

Add realtime-feeling voice output to the virtual assistant system while preserving the current Qwen3-TTS `.pt` cloned voice and the existing task-based TTS fallback.

The system should play the first short audio segment as soon as it is ready, continue playing later segments in order, and support user interruption.

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
OpenClaw text reply or text delta
  -> Virtual Assistant API sentence buffer
  -> Voice Workflow TTS short chunk API
  -> Virtual Assistant API WebSocket event
  -> Next.js frontend AudioQueue
  -> MMD speaking state
```

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
  "text": "你好，我已经帮你查到了。这个方案可以分三步处理。",
  "emotion_label": "日常平静"
}
```

Frontend cancels:

```json
{
  "type": "cancel"
}
```

Backend sends:

```json
{
  "type": "synthesis_started",
  "session_id": "session-1"
}
```

```json
{
  "type": "audio_ready",
  "sequence": 1,
  "text": "你好，我已经帮你查到了。",
  "audio_url": "/tts/proxy/realtime/session-1/0001",
  "duration": 1.2,
  "elapsed_seconds": 0.8
}
```

```json
{
  "type": "done",
  "session_id": "session-1"
}
```

```json
{
  "type": "cancelled",
  "session_id": "session-1"
}
```

### 2.4 Proxy audio URLs

The Voice service may return:

```text
/api/v1/audio/realtime/session-1/0001.wav
```

The browser should not fetch Voice Workflow TTS directly. The virtual assistant backend must expose a proxy URL, for example:

```text
/tts/proxy/realtime/{session_id}/{sequence}
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

- `voice.realtime.started`
- `voice.realtime.chunk_requested`
- `voice.realtime.chunk_ready`
- `voice.realtime.chunk_failed`
- `voice.realtime.cancelled`
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

First implementation can wait for full OpenClaw text, split it, then request chunk TTS.

Later implementation can use OpenClaw text deltas if OpenClaw supports streaming.

## Required Frontend Changes

### 2.7 Add audio queue

Create:

```text
web/src/lib/audioQueue.ts
```

Required API:

```ts
export type AudioQueueItem = {
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

- Sort by `sequence`.
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
export function sessionVoiceWebSocketUrl(sessionId: string): string;
```

It must follow existing Next.js proxy conventions.

### 2.9 Update Chatbox/session component

Behavior:

1. On assistant reply ready, send `synthesize` over voice WebSocket if realtime voice is enabled.
2. On each `audio_ready`, enqueue audio.
3. On user new message:
   - stop queue
   - send cancel
4. On WebSocket failure:
   - fall back to existing `assistant_message.tts.proxy_audio_url`

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

## Virtual Assistant Acceptance Criteria

1. User sends message and assistant text appears as before.
2. With realtime voice enabled, first short audio segment starts before all voice segments are ready.
3. Audio segments play in sequence order.
4. No overlapping audio.
5. Sending another user message cancels current voice and clears queue.
6. If realtime voice fails, existing task-based TTS fallback still plays.
7. Trace logs show chunk request/ready/cancel timings.

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
- `x-openclaw-agent-id = gpt-5-4`.
- `x-openclaw-message-channel = feishu`.
- `/v1/audio/speech` currently returns 404.
- WebSocket RPC is used for Bridge, not current frontend message flow.

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

### 3.1 Confirm or add text streaming for `/v1/responses`

Preferred target:

```text
POST /v1/responses
stream=true
```

The stream should emit text deltas as soon as they are available.

Suggested event shape:

```json
{
  "type": "response.output_text.delta",
  "delta": "你好，"
}
```

Completion:

```json
{
  "type": "response.completed"
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

If OpenClaw cannot support streaming yet, no blocker for phase 1. The virtual assistant backend can wait for full text and then split it.

### 3.2 Preserve existing non-streaming contract

Do not break:

```text
POST /v1/responses
model=openclaw
x-openclaw-agent-id=gpt-5-4
x-openclaw-message-channel=feishu
```

Existing message flow depends on non-streaming response compatibility.

### 3.3 Expose timing metadata if available

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

### 3.4 Do not route voice through `/v1/audio/speech`

For this plan, voice remains in Voice Workflow TTS because:

- Current OpenClaw `/v1/audio/speech` is 404.
- Voice Workflow TTS preserves `.pt` cloned voice.

## OpenClaw Acceptance Criteria

Minimum:

1. Existing `/v1/responses` non-streaming behavior remains stable.
2. Gateway documents whether `stream=true` is supported.
3. If streaming is supported, text delta event schema is stable.

Nice-to-have:

1. First-token timing is exposed.
2. Completion/error events are explicit.
3. Streaming can preserve Feishu session context.

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
  -d '{"text":"这是实时语音测试。","emotion_label":"日常平静","session_id":"smoke","sequence":1}'
```

Exit criteria:

- Returns playable WAV URL.
- Existing `/api/v1/tts` still works.

## Phase 2: Virtual Assistant Backend

Deliver:

- TTS chunk client
- sentence splitter
- realtime voice WebSocket
- proxy URL for chunk audio
- trace events

Exit criteria:

- A WebSocket client receives `audio_ready` events in order.
- Browser-safe audio URLs can be fetched.

## Phase 3: Virtual Assistant Frontend

Deliver:

- `AudioQueue`
- voice WebSocket integration
- cancel on new message
- MMD speaking state integration
- fallback to existing TTS

Exit criteria:

- First segment plays before all segments are ready.
- New message interrupts current playback.

## Phase 4: OpenClaw Streaming Optional Upgrade

Deliver:

- text delta streaming from OpenClaw if supported
- backend sentence buffer consumes deltas

Exit criteria:

- TTS can start before full assistant reply is complete.

---

# Key Risks

1. Qwen3-TTS Base does not provide true audio streaming from `generate_voice_clone`.
2. CPU inference is too slow for production realtime.
3. OpenClaw may not stream text yet.
4. Browser playback cannot directly fetch external TTS URLs unless proxied.
5. Cancel cannot interrupt an in-flight model call; it can only discard its result.

# Required Metrics

Track these in trace:

```text
openclaw.first_text_ms
openclaw.total_text_ms
tts.chunk.requested_at
tts.chunk.ready_at
tts.chunk.elapsed_ms
voice.first_audio_ready_ms
frontend.first_audio_play_ms
voice.cancelled_at
```

These metrics determine whether bottleneck is OpenClaw, Voice Workflow TTS, main API orchestration, or frontend playback.

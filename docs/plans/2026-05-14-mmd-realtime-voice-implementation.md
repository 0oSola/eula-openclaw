# MMD Realtime Voice Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first usable realtime voice side channel for MMD Companion: OpenClaw text streaming adapter, sentence chunking, queued TTS chunk generation, backend WebSocket events, audio proxying, and frontend ordered playback with safe fallback.

**Architecture:** The FastAPI backend owns realtime voice orchestration. It exposes a session-scoped WebSocket, validates `user_id` using the existing Message Service v2 account/session model, queues voice jobs per session, uses OpenClaw SSE text deltas where needed, calls Voice Workflow TTS `/api/v1/tts/chunk`, stores short-lived chunk URL references in memory, and emits `audio_ready` events. The frontend connects to that WebSocket, sends assistant text for synthesis, plays `audio_ready` URLs through an ordered `AudioQueue`, tracks whether any chunk has played, and only auto-fallbacks to full `message_tts` before partial playback.

**Tech Stack:** FastAPI, httpx, pytest, Starlette TestClient/WebSocketTestSession, Next.js/React, browser `Audio`, Node test scripts.

---

### Task 1: Realtime Voice Config And TTS Chunk Client

**Files:**
- Modify: `api/app/config.py`
- Modify: `api/app/services/voice_workflow_tts_client.py`
- Test: `api/tests/test_voice_workflow_tts_client.py`

**Step 1: Write failing tests**

Add tests that prove:

```python
def test_voice_workflow_tts_chunk_returns_reference():
    # Mock POST /api/v1/tts/chunk returns:
    # {"session_id":"tts-session","sequence":1,"status":"ready",
    #  "audio_url":"/api/v1/audio/realtime/tts-session/0001.wav",
    #  "duration":1.6,"elapsed_seconds":15.817}
    # Assert synthesize_chunk() posts text/pause/emotion and returns absolute audio_url,
    # duration_seconds=1.6, elapsed_seconds=15.817.
```

```python
def test_voice_workflow_tts_chunk_rejects_missing_audio_url():
    # Mock 200 JSON missing audio_url.
    # Assert VoiceWorkflowTtsError.
```

```python
def test_voice_workflow_tts_cancel_realtime_posts_session_cancel():
    # Mock POST /api/v1/tts/realtime/sess-1/cancel.
    # Assert cancel_realtime("sess-1") returns True from {"cancelled": true}.
```

**Step 2: Verify RED**

Run:

```bash
python -m pytest api/tests/test_voice_workflow_tts_client.py -q
```

Expected: fails because `synthesize_chunk` and `cancel_realtime` do not exist.

**Step 3: Implement minimal client support**

Add dataclass:

```python
@dataclass(slots=True)
class VoiceWorkflowTtsChunk:
    session_id: str
    sequence: int
    status: str
    audio_url: str
    duration_seconds: float | None = None
    elapsed_seconds: float | None = None
```

Add `synthesize_chunk(text, emotion_label=None, pause_profile="podcast", session_id=None, sequence=None)` that posts to `/api/v1/tts/chunk`, validates non-empty `audio_url`, normalizes relative URL using `_absolute_audio_url()`, maps service `duration` to `duration_seconds`, and returns `VoiceWorkflowTtsChunk`.

Add `cancel_realtime(session_id)` that posts `/api/v1/tts/realtime/{session_id}/cancel`, accepts 2xx, and returns `bool(data.get("cancelled"))`.

Add settings fields:

```python
realtime_voice_enabled: bool
realtime_voice_max_queue_size: int
realtime_voice_chunk_timeout_seconds: int
realtime_voice_circuit_failure_threshold: int
realtime_voice_circuit_window_seconds: int
realtime_voice_circuit_open_seconds: int
realtime_voice_max_queue_wait_seconds: int
openclaw_stream_mode: str
```

**Step 4: Verify GREEN**

Run:

```bash
python -m pytest api/tests/test_voice_workflow_tts_client.py -q
```

Expected: all tests pass.

**Step 5: Commit**

```bash
git add api/app/config.py api/app/services/voice_workflow_tts_client.py api/tests/test_voice_workflow_tts_client.py
git commit -m "feat: add realtime voice tts chunk client"
```

---

### Task 2: Sentence Splitter And Session Circuit Service

**Files:**
- Create: `api/app/services/realtime_voice.py`
- Test: `api/tests/test_realtime_voice.py`

**Step 1: Write failing tests**

Cover:

```python
def test_split_assistant_text_prefers_sentence_boundaries():
    assert split_assistant_text("你好。我查到了，可以分三步。", max_chars=12) == ["你好。", "我查到了，", "可以分三步。"]
```

```python
def test_voice_session_queue_rejects_when_full():
    # queue max size 3, enqueue 4 jobs.
    # Fourth result is rejected with reason queue_full and fallback message_tts.
```

```python
def test_circuit_opens_after_session_failure_threshold():
    # record threshold failures in window.
    # Assert state open, new job rejected(circuit_open), half_open allows one probe after cooldown.
```

**Step 2: Verify RED**

Run:

```bash
python -m pytest api/tests/test_realtime_voice.py -q
```

Expected: import failure because module does not exist.

**Step 3: Implement minimal service**

Implement:

```python
split_assistant_text(text: str, *, max_chars: int = 25, min_segment_chars: int = 10) -> list[str]
```

Implement in-memory session state:

```python
RealtimeVoiceJob
RealtimeVoiceQueue
SessionCircuitBreaker
RealtimeVoiceRegistry
```

Keep phase 1 session-level only. Failure reasons: `queue_full`, `tts_chunk_timeout`, `tts_chunk_failed`, `openclaw_stream_failed`, `proxy_failed`, `playback_failed`, `queue_wait_timeout`.

**Step 4: Verify GREEN**

Run:

```bash
python -m pytest api/tests/test_realtime_voice.py -q
```

Expected: pass.

**Step 5: Commit**

```bash
git add api/app/services/realtime_voice.py api/tests/test_realtime_voice.py
git commit -m "feat: add realtime voice queue and circuit service"
```

---

### Task 3: Realtime Voice WebSocket And Proxy Route

**Files:**
- Create: `api/app/routes/realtime_voice.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_realtime_voice_route.py`

**Step 1: Write failing tests**

Cover:

```python
def test_voice_websocket_requires_query_user_id():
    # ws_connect /ws/sessions/{session_id}/voice without user_id.
    # Expect close / failure before synthesize is accepted.
```

```python
def test_voice_websocket_rejects_unauthorized_session():
    # Create session for u1, connect as u2.
    # Expect rejected connection.
```

```python
def test_voice_websocket_synthesize_emits_audio_ready_and_done():
    # Fake tts_client.synthesize_chunk returns two chunks.
    # Send synthesize with message_id/job_id/text.
    # Expect queued, synthesis_started, audio_ready sequence 1..N, done.
```

```python
def test_realtime_proxy_serves_registered_chunk_audio():
    # Register remote chunk URL in registry.
    # GET /tts/proxy/realtime/{session}/{job}/{sequence}?user_id=u1
    # Assert audio bytes and media type.
```

**Step 2: Verify RED**

Run:

```bash
python -m pytest api/tests/test_realtime_voice_route.py -q
```

Expected: route/module missing.

**Step 3: Implement route**

Add router with:

```text
WS /ws/sessions/{session_id}/voice?user_id={user_id}
GET /tts/proxy/realtime/{session_id}/{job_id}/{sequence}
```

WebSocket behavior:
- Validate `user_id` query using `trace_store.get_current_workspace_context(user_id)`.
- Validate session belongs to user/workspace via `store.get_session`.
- Reject if `settings.realtime_voice_enabled` or `tts_service_enabled` is false.
- On `synthesize`, enqueue job. If rejected, send `rejected(reason, fallback="message_tts")`.
- Process one job per session in phase 1.
- For each sentence segment, call `tts_client.synthesize_chunk`.
- Register remote audio URL to in-memory proxy registry.
- Emit `audio_ready` with `job_id`, `sequence`, `duration`, `elapsed_seconds`, `audio_url`.
- On `cancel(scope=all)`, clear queue, call `tts_client.cancel_realtime(session_id)`, send `cancelled`.

**Step 4: Verify GREEN**

Run:

```bash
python -m pytest api/tests/test_realtime_voice_route.py -q
python -m pytest api/tests -q
```

Expected: all backend tests pass.

**Step 5: Commit**

```bash
git add api/app/main.py api/app/routes/realtime_voice.py api/tests/test_realtime_voice_route.py
git commit -m "feat: add realtime voice websocket route"
```

---

### Task 4: OpenClaw HTTP SSE Stream Adapter

**Files:**
- Modify: `api/app/services/openclaw_client.py`
- Test: `api/tests/test_openclaw_client.py`

**Step 1: Write failing tests**

Cover:

```python
def test_openclaw_stream_reply_yields_text_deltas():
    # Mock POST /v1/responses stream=true SSE:
    # data: {"type":"response.output_text.delta","delta":"你"}
    # data: {"type":"response.output_text.delta","delta":"好"}
    # data: {"type":"response.completed","response":{"status":"completed"}}
    # Assert ["你", "好"].
```

```python
def test_openclaw_stream_reply_raises_on_error_event():
    # Mock data: {"type":"response.error","error":{"message":"bad"}}
    # Assert OpenClawInvocationError.
```

**Step 2: Verify RED**

Run:

```bash
python -m pytest api/tests/test_openclaw_client.py -q
```

Expected: fails because `stream_reply` does not exist.

**Step 3: Implement SSE parser**

Add:

```python
async def stream_reply(self, user_id: str, session_id: str | None, message: str, history: list[dict[str, str]]) -> AsyncIterator[str]
```

Use `/v1/responses` with `stream=true`, parse `data:` lines, yield `response.output_text.delta`, stop on `response.completed` or `[DONE]`, raise on `response.error`.

**Step 4: Verify GREEN**

Run:

```bash
python -m pytest api/tests/test_openclaw_client.py -q
python -m pytest api/tests -q
```

Expected: all backend tests pass.

**Step 5: Commit**

```bash
git add api/app/services/openclaw_client.py api/tests/test_openclaw_client.py
git commit -m "feat: add openclaw responses stream adapter"
```

---

### Task 5: Frontend AudioQueue And WebSocket URL Helper

**Files:**
- Modify: `web/src/lib/api.ts`
- Create: `web/src/lib/realtimeVoiceQueue.js`
- Test: `web/tests/realtime-voice-queue.test.mjs`
- Modify: `web/tests/run-basic-checks.mjs`

**Step 1: Write failing tests**

Cover:

```javascript
assert.equal(sessionVoiceWebSocketUrl("s 1", "admin-1"), "ws://.../ws/sessions/s%201/voice?user_id=admin-1")
```

Cover `AudioQueue`:
- plays job order then sequence order
- does not overlap audio
- records `hasPlayedChunk(jobId)`
- on error before first chunk returns `auto_before_playback`
- on error after partial playback returns `manual_after_partial_playback`

**Step 2: Verify RED**

Run:

```bash
npm --prefix web run check:basic
node web/tests/realtime-voice-queue.test.mjs
```

Expected: fail because helper/queue do not exist.

**Step 3: Implement minimal frontend utilities**

Add `sessionVoiceWebSocketUrl(sessionId, userId)` using current origin and `encodeURIComponent`.

Add `AudioQueue` class that accepts an `AudioCtor`, enqueues `{jobId, sequence, url, text, duration}`, sorts by first-seen job order and sequence, plays one at a time, and exposes stop/clear and `hasPlayedChunk(jobId)`.

**Step 4: Verify GREEN**

Run:

```bash
node web/tests/realtime-voice-queue.test.mjs
npm --prefix web run check:basic
```

Expected: pass.

**Step 5: Commit**

```bash
git add web/src/lib/api.ts web/src/lib/realtimeVoiceQueue.js web/tests/realtime-voice-queue.test.mjs web/tests/run-basic-checks.mjs
git commit -m "feat: add realtime voice frontend queue"
```

---

### Task 6: Companion Page Realtime Voice Integration

**Files:**
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/app/companion/CompanionChatbox.tsx`
- Test: `web/tests/run-basic-checks.mjs`

**Step 1: Write failing tests**

Update static/basic checks to assert:
- `sessionVoiceWebSocketUrl` is imported.
- `AudioQueue` is used.
- sending a new user message does not call realtime stop/cancel by default.
- explicit stop/clear sends `cancel(scope="all")`.
- `partial_failed` status exists.

**Step 2: Verify RED**

Run:

```bash
npm --prefix web run check:basic
```

Expected: fail on new static assertions.

**Step 3: Implement minimal UI integration**

Add realtime voice refs/state:

```ts
voiceSocketRef
audioQueueRef
realtimeVoiceStatus
```

On assistant message ready and `ttsEnabled && ttsMode === "server"`, send `synthesize` over WebSocket. On `audio_ready`, enqueue. On `rejected`, fallback to message-level TTS. On errors, use `AudioQueue.hasPlayedChunk(jobId)` to choose auto fallback vs `partial_failed`.

Do not cancel current realtime voice on new user message. Only explicit stop/clear or session switch sends `cancel(scope="all")`.

**Step 4: Verify GREEN**

Run:

```bash
npm --prefix web run check:basic
```

Expected: pass.

**Step 5: Commit**

```bash
git add web/src/app/companion/page.tsx web/src/lib/types.ts web/src/app/companion/CompanionChatbox.tsx web/tests/run-basic-checks.mjs
git commit -m "feat: wire companion realtime voice playback"
```

---

### Task 7: Final Verification And Docs

**Files:**
- Modify if needed: `docs/architecture/current-system-topology.md`
- Modify if needed: `docs/specs/2026-05-13-mmd-realtime-voice-spec.zh-CN.md`

**Step 1: Run full verification**

Run:

```bash
python -m pytest api/tests -q
npm --prefix web run check:basic
npm --prefix web run build
git diff --check
```

Expected: all pass.

**Step 2: Review commit boundary**

Run:

```bash
git status --short
git diff --stat
```

Expected: no generated data staged. Ignore `web/node_modules`, `.next-codex-*`, `api/tests/tests_runtime`, local DB/logs.

**Step 3: Commit final docs if changed**

```bash
git add docs/architecture/current-system-topology.md docs/specs/2026-05-13-mmd-realtime-voice-spec.zh-CN.md
git commit -m "docs: update realtime voice implementation notes"
```

Only commit docs if implementation changed the planned contract.

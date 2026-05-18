# Daily Podcast Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the Daily Podcast experience: backend podcast aggregation/proxy APIs, `/companion` latest podcast card, `/podcasts` history page, and a real Canvas waveform player with click/drag seek.

**Architecture:** FastAPI owns all Voice Workflow service access. It reads `podcast/latest.json`, reads `meta.json`, probes OGG/WAV audio with ranged GET, and exposes same-origin podcast JSON/audio routes. Next.js consumes only this backend API, renders a restrained MIO HUD-style podcast page, and uses `<audio>` plus Canvas for waveform visualization and seek interactions.

**Tech Stack:** FastAPI, httpx, pytest, Starlette TestClient, Next.js 15, React 19, TypeScript, Canvas 2D, Web Audio API, Node test scripts.

---

### Task 1: Backend Podcast Service

**Files:**
- Create: `api/app/services/daily_podcast.py`
- Test: `api/tests/test_daily_podcast_service.py`
- Reuse: `api/app/services/voice_workflow_tts_client.py`

**Step 1: Write the failing tests**

Create `api/tests/test_daily_podcast_service.py` with a fake Voice Workflow client backed by `httpx.MockTransport`.

Cover:

```python
def test_latest_podcast_prefers_ogg_when_probe_succeeds():
    # latest.json returns date/metaPath.
    # meta.json returns docUrl, docLinks, counts, audio.oggPath, audio.wavPath.
    # Range GET podcast_20260518.ogg returns 206 + content-type audio/ogg + content-range bytes 0-1023/1388346.
    # Assert result.status == "ready", audio.source == "ogg", audio.format == "audio/ogg",
    # audio.bytes == 1388346, and audio.url == "/podcasts/daily/2026-05-18/audio?format=preferred".
```

```python
def test_latest_podcast_falls_back_to_wav_when_ogg_missing():
    # OGG probe returns 404, WAV probe returns 206 + content-type audio/wav.
    # Assert audio.source == "wav" and audio.format == "audio/wav".
```

```python
def test_meta_with_doc_but_no_audio_maps_partial():
    # meta ok=true/docUrl exists, both probes return 404.
    # Assert status == "partial", docUrl is preserved, audio.url is None.
```

```python
def test_missing_meta_maps_missing():
    # latest.json points to meta path that returns 404.
    # Assert status == "missing".
```

```python
def test_recent_list_scans_from_latest_date_and_omits_missing_dates():
    # latest date is 2026-05-18.
    # 2026-05-18 and 2026-05-16 meta exist; 2026-05-17 returns 404.
    # Assert list dates are ["2026-05-18", "2026-05-16"].
```

**Step 2: Run test to verify it fails**

Run:

```bash
python -m pytest api/tests/test_daily_podcast_service.py -q
```

Expected: FAIL because `app.services.daily_podcast` does not exist.

**Step 3: Implement minimal service**

Create `api/app/services/daily_podcast.py`.

Implement dataclasses:

```python
@dataclass(slots=True)
class PodcastAudio:
    url: str | None
    remote_url: str | None
    format: str | None
    bytes: int | None
    source: str | None

@dataclass(slots=True)
class DailyPodcast:
    date: str
    status: str
    doc_url: str | None
    doc_links: dict[str, str]
    audio: PodcastAudio
    counts: dict[str, int]
    script_chars: int | None
    updated_at: str | None
    audio_error: str | None
    meta_path: str | None
```

Implement service:

```python
class DailyPodcastService:
    def __init__(self, *, tts_client: VoiceWorkflowTtsClient) -> None: ...
    async def latest(self) -> DailyPodcast: ...
    async def by_date(self, date: str) -> DailyPodcast: ...
    async def list_recent(self, *, days: int = 30) -> list[DailyPodcast]: ...
```

Implementation details:

- Use `tts_client.eula_storage_url(path)` for `latest.json`, `metaPath`, `audio.oggPath`, and `audio.wavPath`.
- Add helper `podcast_meta_storage_path(date)` returning `podcast/YYYY/MM/DD/podcast_YYYYMMDD.meta.json`.
- Fetch JSON using `tts_client.http_client.get(url, timeout=tts_client.timeout_seconds)`.
- Probe audio using:

```python
response = await tts_client.http_client.get(url, headers={"Range": "bytes=0-1023"}, timeout=tts_client.timeout_seconds)
```

- Treat only `2xx/206` and `content-type` starting with `audio/` as usable.
- Parse total bytes from `Content-Range: bytes 0-1023/1388346`, else use `Content-Length` if present.
- Return frontend audio URL as `/podcasts/daily/{date}/audio?format=preferred`.
- Keep `remote_url` internal for route proxy use.
- Status mapping:
  - meta 404 -> `missing`
  - audio usable -> `ready`
  - doc exists but audio missing -> `partial`
  - meta `ok=false` and no doc -> `failed`

**Step 4: Run test to verify it passes**

Run:

```bash
python -m pytest api/tests/test_daily_podcast_service.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
git add api/app/services/daily_podcast.py api/tests/test_daily_podcast_service.py
git commit -m "feat: add daily podcast service"
```

---

### Task 2: Backend Podcast Routes And Audio Proxy

**Files:**
- Create: `api/app/routes/podcasts.py`
- Modify: `api/app/main.py`
- Test: `api/tests/test_podcast_routes.py`
- Reuse: `api/app/services/daily_podcast.py`

**Step 1: Write the failing tests**

Create `api/tests/test_podcast_routes.py`.

Use `create_app({"data_dir": str(_make_case_dir()), "admin_user_ids": [], "tts_service_enabled": True})`, replace `app.state.tts_client` with a fake client that exposes `eula_storage_url` and `http_client`.

Cover:

```python
def test_get_latest_podcast_returns_normalized_payload():
    response = client.get("/podcasts/daily/latest", headers={"x-user-id": "u1"})
    assert response.status_code == 200
    assert response.json()["podcast"]["date"] == "2026-05-18"
    assert response.json()["podcast"]["audio"]["url"] == "/podcasts/daily/2026-05-18/audio?format=preferred"
```

```python
def test_list_podcasts_defaults_to_30_days():
    response = client.get("/podcasts/daily", headers={"x-user-id": "u1"})
    assert response.status_code == 200
    assert response.json()["days"] == 30
    assert [item["date"] for item in response.json()["items"]] == ["2026-05-18"]
```

```python
def test_podcast_audio_proxy_preserves_audio_headers_and_range():
    response = client.get(
        "/podcasts/daily/2026-05-18/audio?format=preferred",
        headers={"x-user-id": "u1", "Range": "bytes=0-1023"},
    )
    assert response.status_code == 206
    assert response.headers["content-type"] == "audio/ogg"
    assert response.headers["accept-ranges"] == "bytes"
    assert response.headers["content-range"] == "bytes 0-1023/1388346"
    assert response.content == b"ogg-range"
```

```python
def test_podcast_audio_proxy_returns_404_when_no_audio():
    response = client.get("/podcasts/daily/2026-05-17/audio?format=preferred", headers={"x-user-id": "u1"})
    assert response.status_code == 404
```

**Step 2: Run test to verify it fails**

Run:

```bash
python -m pytest api/tests/test_podcast_routes.py -q
```

Expected: FAIL because route is not registered.

**Step 3: Implement route**

Create `api/app/routes/podcasts.py`:

```python
router = APIRouter(prefix="/podcasts", tags=["podcasts"])
```

Routes:

```text
GET /podcasts/daily/latest
GET /podcasts/daily?days=30
GET /podcasts/daily/{date}
GET /podcasts/daily/{date}/audio?format=preferred
```

Implementation details:

- Instantiate `DailyPodcastService(tts_client=request.app.state.tts_client)` per request.
- Serialize dataclasses to snake_case JSON matching the frontend DTO.
- Clamp `days` to `1..90`, default `30`.
- For audio proxy:
  - Resolve the podcast by date and selected audio.
  - Forward the incoming `Range` header to `tts_client.http_client.get(remote_url, headers={...})`.
  - Return `Response(content=response.content, status_code=response.status_code, media_type=media_type, headers=headers)`.
  - Preserve `accept-ranges`, `content-range`, `content-length`, `last-modified`, and `etag` if present.
  - Return `404` if no usable audio exists.

Modify `api/app/main.py`:

```python
from app.routes.podcasts import router as podcasts_router
...
app.include_router(podcasts_router)
```

**Step 4: Run test to verify it passes**

Run:

```bash
python -m pytest api/tests/test_podcast_routes.py -q
python -m pytest api/tests/test_daily_podcast_service.py -q
```

Expected: PASS.

**Step 5: Commit**

```bash
git add api/app/routes/podcasts.py api/app/main.py api/tests/test_podcast_routes.py
git commit -m "feat: expose daily podcast api"
```

---

### Task 3: Frontend Podcast Types, API Client, And Waveform Utilities

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/api.ts`
- Create: `web/src/lib/audioWaveform.js`
- Test: `web/tests/audio-waveform.test.mjs`
- Modify: `web/tests/run-basic-checks.mjs`

**Step 1: Write the failing tests**

Create `web/tests/audio-waveform.test.mjs`.

Cover pure logic only:

```javascript
import assert from "node:assert/strict";
import { computePeaks, seekTimeFromPointer } from "../src/lib/audioWaveform.js";

assert.deepEqual(computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2), [0.5, 1]);
assert.equal(seekTimeFromPointer({ clientX: 75, left: 25, width: 100, duration: 120 }), 60);
assert.equal(seekTimeFromPointer({ clientX: -10, left: 0, width: 100, duration: 120 }), 0);
assert.equal(seekTimeFromPointer({ clientX: 200, left: 0, width: 100, duration: 120 }), 120);
```

Update `web/tests/run-basic-checks.mjs` to assert:

```javascript
assert.match(typesSource, /export type DailyPodcast/);
assert.match(apiSource, /export async function getLatestDailyPodcast/);
assert.match(apiSource, /export async function listDailyPodcasts/);
assert.match(apiSource, /export async function getDailyPodcast/);
```

**Step 2: Run tests to verify they fail**

Run:

```bash
node web/tests/audio-waveform.test.mjs
npm --prefix web run check:basic
```

Expected: FAIL because types/API/helpers do not exist.

**Step 3: Implement types and API client**

Add to `web/src/lib/types.ts`:

```ts
export type PodcastStatus = "ready" | "partial" | "processing" | "missing" | "failed";

export type DailyPodcast = {
  date: string;
  status: PodcastStatus;
  doc_url: string | null;
  doc_links: Record<string, string>;
  audio: {
    url: string | null;
    format: "audio/ogg" | "audio/wav" | null;
    bytes: number | null;
    source: "ogg" | "wav" | null;
  };
  counts: Record<string, number>;
  script_chars: number | null;
  updated_at: string | null;
  audio_error: string | null;
};
```

Add to `web/src/lib/api.ts`:

```ts
export async function getLatestDailyPodcast(userId: string): Promise<DailyPodcast> {
  const payload = await requestJSON<{ podcast: DailyPodcast }>("/podcasts/daily/latest", { method: "GET", userId });
  return payload.podcast;
}

export async function listDailyPodcasts(userId: string, days = 30): Promise<DailyPodcast[]> {
  const params = new URLSearchParams({ days: String(days) });
  const payload = await requestJSON<{ items: DailyPodcast[] }>(`/podcasts/daily?${params.toString()}`, {
    method: "GET",
    userId,
  });
  return payload.items || [];
}

export async function getDailyPodcast(userId: string, date: string): Promise<DailyPodcast> {
  const payload = await requestJSON<{ podcast: DailyPodcast }>(`/podcasts/daily/${encodeURIComponent(date)}`, {
    method: "GET",
    userId,
  });
  return payload.podcast;
}
```

Add `web/src/lib/audioWaveform.js`:

```javascript
export function computePeaks(samples, bucketCount) {
  const safeBucketCount = Math.max(1, Math.floor(bucketCount || 1));
  const bucketSize = Math.max(1, Math.ceil(samples.length / safeBucketCount));
  const peaks = [];
  for (let bucket = 0; bucket < safeBucketCount; bucket += 1) {
    let max = 0;
    const start = bucket * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    for (let index = start; index < end; index += 1) {
      max = Math.max(max, Math.abs(samples[index] || 0));
    }
    peaks.push(Number(max.toFixed(4)));
  }
  return peaks;
}

export function seekTimeFromPointer({ clientX, left, width, duration }) {
  if (!duration || !width) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return duration * ratio;
}
```

**Step 4: Run tests to verify they pass**

Run:

```bash
node web/tests/audio-waveform.test.mjs
npm --prefix web run check:basic
```

Expected: PASS.

**Step 5: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts web/src/lib/audioWaveform.js web/tests/audio-waveform.test.mjs web/tests/run-basic-checks.mjs
git commit -m "feat: add podcast frontend api"
```

---

### Task 4: Canvas Waveform Player Component

**Files:**
- Create: `web/src/app/podcasts/PodcastWaveform.tsx`
- Modify: `web/tests/run-basic-checks.mjs`
- Reuse: `web/src/lib/audioWaveform.js`

**Step 1: Write the failing static checks**

Update `web/tests/run-basic-checks.mjs` to read `web/src/app/podcasts/PodcastWaveform.tsx` and assert:

```javascript
assert.match(waveformSource, /<canvas/);
assert.match(waveformSource, /decodeAudioData/);
assert.match(waveformSource, /requestAnimationFrame/);
assert.match(waveformSource, /onPointerDown/);
assert.match(waveformSource, /setPointerCapture/);
assert.match(waveformSource, /seekTimeFromPointer/);
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix web run check:basic
```

Expected: FAIL because `PodcastWaveform.tsx` does not exist.

**Step 3: Implement component**

Create `web/src/app/podcasts/PodcastWaveform.tsx`.

Component contract:

```ts
type PodcastWaveformProps = {
  audioUrl: string | null;
  format: string | null;
  title: string;
};
```

Implementation requirements:

- Render a hidden or visually integrated `<audio ref={audioRef} src={audioUrl || undefined} preload="metadata" />`.
- Render a `<canvas>` with stable height.
- Fetch `audioUrl`, decode through `AudioContext.decodeAudioData`, and compute peaks using `computePeaks(channelData, canvasWidth)`.
- Draw unplayed waveform and played waveform into the same canvas.
- Use `requestAnimationFrame` while playing to update progress.
- Use Pointer Events:
  - `onPointerDown`: capture pointer, seek.
  - `onPointerMove`: while dragging, seek.
  - `onPointerUp`: release.
- If `audioUrl` is null, render disabled player state.
- If decode fails, keep the audio play button available and show a compact waveform unavailable state.
- Do not use fake waveform when audio is unavailable.

**Step 4: Run test to verify it passes**

Run:

```bash
npm --prefix web run check:basic
```

Expected: PASS.

**Step 5: Commit**

```bash
git add web/src/app/podcasts/PodcastWaveform.tsx web/tests/run-basic-checks.mjs
git commit -m "feat: add podcast waveform player"
```

---

### Task 5: `/podcasts` Page

**Files:**
- Create: `web/src/app/podcasts/page.tsx`
- Modify: `web/src/app/globals.css`
- Modify: `web/tests/run-basic-checks.mjs`
- Reuse: `web/src/app/podcasts/PodcastWaveform.tsx`
- Reuse: `web/src/lib/api.ts`

**Step 1: Write failing static checks**

Update `web/tests/run-basic-checks.mjs` to read `web/src/app/podcasts/page.tsx` and assert:

```javascript
assert.match(podcastsPageSource, /getLatestDailyPodcast/);
assert.match(podcastsPageSource, /listDailyPodcasts\(session\.userId,\s*30\)/);
assert.match(podcastsPageSource, /<PodcastWaveform/);
assert.match(podcastsPageSource, /href="\/companion"/);
assert.match(podcastsPageSource, /Feishu Doc/);
assert.match(cssSource, /\.podcast-page/);
assert.match(cssSource, /\.podcast-waveform-card/);
assert.match(cssSource, /\.podcast-history-row/);
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix web run check:basic
```

Expected: FAIL because `/podcasts` page and CSS classes do not exist.

**Step 3: Implement page**

Create `web/src/app/podcasts/page.tsx` as a client page.

Behavior:

- Load session via `loadSession()`.
- If no session, show a compact panel linking to `/`.
- On mount, load latest and list in parallel:

```ts
const [latest, items] = await Promise.all([
  getLatestDailyPodcast(session.userId),
  listDailyPodcasts(session.userId, 30),
]);
```

- Refresh button reloads both.
- Latest area:
  - title `Daily Podcast`
  - date
  - status chip
  - audio format
  - `PodcastWaveform`
  - Feishu doc link when `doc_url` exists
- Recent 30 Days:
  - render compact rows
  - show date/status/audio format
  - row play action can set selected latest-style playback target
  - expand button shows `doc_links`, `counts`, `script_chars`, and `audio_error`

CSS requirements:

- Add `/podcasts` classes to `web/src/app/globals.css`.
- Use dark HUD panels, restrained cyan edge light, no full starfield and no decorative orb background.
- Keep border radius at 8px or below.
- Avoid nested card styling.
- Ensure mobile/narrow layout does not overlap.

**Step 4: Run test to verify it passes**

Run:

```bash
npm --prefix web run check:basic
```

Expected: PASS.

**Step 5: Commit**

```bash
git add web/src/app/podcasts/page.tsx web/src/app/globals.css web/tests/run-basic-checks.mjs
git commit -m "feat: add daily podcast page"
```

---

### Task 6: Companion Right Rail Podcast Card

**Files:**
- Modify: `web/src/app/companion/CompanionRightRail.tsx`
- Modify: `web/src/app/companion/page.tsx`
- Modify: `web/src/app/globals.css`
- Modify: `web/tests/run-basic-checks.mjs`
- Reuse: `web/src/lib/api.ts`
- Reuse: `web/src/lib/types.ts`

**Step 1: Write failing static checks**

Update `web/tests/run-basic-checks.mjs`:

```javascript
assert.match(rightRailSource, /Daily Podcast/);
assert.match(rightRailSource, /href="\/podcasts"/);
assert.doesNotMatch(rightRailSource, /mio-trace-card/);
assert.match(companionPageSource, /getLatestDailyPodcast/);
assert.match(cssSource, /\.mio-podcast-card/);
```

**Step 2: Run test to verify it fails**

Run:

```bash
npm --prefix web run check:basic
```

Expected: FAIL because right rail still renders Trace card.

**Step 3: Implement right rail integration**

Modify `CompanionRightRail.tsx`:

- Add prop:

```ts
dailyPodcast: DailyPodcast | null;
onRefreshDailyPodcast: () => void;
```

- Replace the Trace article in `OverviewWorkspace` with a `mio-podcast-card`.
- Render:
  - title `Daily Podcast`
  - date or `--`
  - status
  - audio format
  - a compact `<audio controls src={dailyPodcast.audio.url || undefined}>` when ready
  - `Feishu Doc` link
  - `List` link to `/podcasts`
  - refresh button

Modify `page.tsx`:

- Import `getLatestDailyPodcast`.
- Add state:

```ts
const [dailyPodcast, setDailyPodcast] = useState<DailyPodcast | null>(null);
```

- Load latest after session is available.
- Pass `dailyPodcast` and refresh handler into `CompanionRightRail`.

CSS:

- Add `.mio-podcast-card`, `.mio-podcast-meta`, `.mio-podcast-actions`.
- Reuse MIO card visual language without increasing right rail width.

**Step 4: Run test to verify it passes**

Run:

```bash
npm --prefix web run check:basic
```

Expected: PASS.

**Step 5: Commit**

```bash
git add web/src/app/companion/CompanionRightRail.tsx web/src/app/companion/page.tsx web/src/app/globals.css web/tests/run-basic-checks.mjs
git commit -m "feat: add podcast card to companion"
```

---

### Task 7: Architecture Docs And Final Verification

**Files:**
- Modify: `docs/architecture/current-system-topology.md`
- Modify if needed: `docs/plans/2026-05-18-daily-podcast-design.md`

**Step 1: Update topology documentation**

Update `docs/architecture/current-system-topology.md` with:

- FastAPI routes:

```text
GET /podcasts/daily/latest
GET /podcasts/daily?days=30
GET /podcasts/daily/{date}
GET /podcasts/daily/{date}/audio?format=preferred
```

- Voice Workflow interface 5 relationship:

```text
FastAPI -> Voice Workflow /api/v1/eula-storage-audio/podcast/latest.json
FastAPI -> Voice Workflow /api/v1/eula-storage-audio/podcast/YYYY/MM/DD/podcast_YYYYMMDD.meta.json
FastAPI -> Voice Workflow audio OGG/WAV with ranged GET
```

- Frontend pages:

```text
/companion right rail Daily Podcast card
/podcasts Daily Podcast history/playback page
```

- Audio policy:

```text
Daily Podcast only: audio/ogg preferred, audio/wav fallback, ranged GET probe.
Older TTS/realtime audio OGG migration remains deferred.
```

**Step 2: Run full verification**

Run:

```bash
python -m pytest api/tests/test_daily_podcast_service.py api/tests/test_podcast_routes.py -q
python -m pytest api/tests -q
node web/tests/audio-waveform.test.mjs
npm --prefix web run check:basic
npm --prefix web run build
git diff --check
```

Expected: all pass.

**Step 3: Manual browser verification**

Start services:

```bash
python -m uvicorn app.main:app --host 127.0.0.1 --port 8100 --reload
npm --prefix web run dev -- --port 3000
```

If port `8100` is occupied or blocked, use another API port and update `NEXT_PUBLIC_API_BASE_URL`.

Verify in browser:

- `/companion` overview right rail shows Daily Podcast card.
- `/podcasts` loads latest `2026-05-18` if Voice service is reachable.
- OGG playback works.
- Canvas waveform renders.
- Clicking waveform seeks.
- Dragging waveform seeks.
- Narrow viewport does not overlap controls or list rows.

**Step 4: Commit docs and final verification notes**

```bash
git add docs/architecture/current-system-topology.md docs/plans/2026-05-18-daily-podcast-design.md
git commit -m "docs: update daily podcast topology"
```

Only commit `docs/plans/2026-05-18-daily-podcast-design.md` if implementation discoveries changed the design.

---

## Implementation Notes

- Do not change older message TTS or realtime voice audio format behavior in this milestone.
- Do not expose Voice local filesystem paths in frontend responses.
- Do not use `HEAD` for Voice audio probes.
- Do not render fake waveforms when audio is missing.
- Keep `/traces` and `/status` routes available even though the first-screen Trace card is removed.
- Avoid committing local runtime data:
  - `api/data/sqlite/*`
  - `api/data/logs/*`
  - `web/.next-codex-dev/*`
  - `api/tests/tests_runtime/*`

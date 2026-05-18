# Daily Podcast Design

Date: 2026-05-18

## Summary

Add a Daily Podcast experience for the MMD Companion project. The feature reads the Voice Workflow service podcast archive through interface 5, exposes a backend-owned podcast API, replaces the first-screen right-side Trace card with a compact latest podcast card, and adds a `/podcasts` page for playback, recent history, and diagnostics.

The confirmed visual direction is an MIO HUD extension: dark HUD panels with restrained cyan edge light, not the full companion starfield background. The page should feel like a polished media surface, not a debug console.

## Confirmed Decisions

- Use Voice Workflow interface 5 as the source of podcast files:
  - `GET {TTS_SERVICE_BASE_URL}/api/v1/eula-storage-audio/podcast/README.md`
  - `GET {TTS_SERVICE_BASE_URL}/api/v1/eula-storage-audio/podcast/latest.json`
  - `GET {TTS_SERVICE_BASE_URL}/api/v1/eula-storage-audio/podcast/YYYY/MM/DD/podcast_YYYYMMDD.meta.json`
- `podcast/latest.json` is the primary latest-entry source.
- `meta.json` is the structured detail source.
- Audio selection is `audio/ogg` first, `audio/wav` fallback.
- Audio probing must use ranged `GET bytes=0-1023`; `HEAD` is not reliable because the Voice service may return `405 Method Not Allowed`.
- Browser playback should go through this project's same-origin backend proxy, not direct Voice service URLs.
- `/companion` first-screen right rail replaces the Trace card with a compact Daily Podcast card.
- `/podcasts` is the full list/detail page.
- `/podcasts` defaults to the latest entry plus a recent 30-day list.
- The latest podcast panel uses a large real Canvas waveform.
- The waveform supports click seek and drag seek.
- Historical rows do not render full waveforms by default; expanded rows may lazy-load waveform data.
- Do not migrate all older Voice/TTS integrations to OGG in this milestone. That is tracked as a deferred follow-up.

## Voice Source Contract

The Voice service stores podcast artifacts under:

```text
podcast/YYYY/MM/DD/
```

Daily files use:

```text
podcast_YYYYMMDD.*
```

Important files:

```text
podcast_YYYYMMDD.meta.json
podcast_YYYYMMDD.md
podcast_YYYYMMDD.txt
podcast_YYYYMMDD.wav
podcast_YYYYMMDD.ogg
```

`latest.json` points to the latest date and meta file. `meta.json` provides:

```json
{
  "ok": true,
  "date": "2026-05-18",
  "scriptPath": "/.../podcast_20260518.txt",
  "markdownPath": "/.../podcast_20260518.md",
  "docUrl": "https://feishu.cn/docx/xxx",
  "docLinks": {
    "daily_news": "https://feishu.cn/docx/xxx",
    "technical_articles": "https://feishu.cn/docx/xxx",
    "top_projects": "https://feishu.cn/docx/xxx"
  },
  "audio": {
    "wavPath": "/.../podcast_20260518.wav",
    "oggPath": "/.../podcast_20260518.ogg"
  },
  "audioError": null,
  "counts": {
    "daily_news": 49,
    "technical_articles": 68,
    "top_projects": 58
  },
  "scriptChars": 2556
}
```

Absolute paths from Voice must be normalized through the existing Eula storage path rules before building remote URLs.

## Backend API

Add a Podcast aggregation layer in the FastAPI API. The frontend should not assemble Voice service URLs.

Routes:

```text
GET /podcasts/daily/latest
GET /podcasts/daily?days=30
GET /podcasts/daily/{date}
GET /podcasts/daily/{date}/audio?format=preferred
```

`GET /podcasts/daily/latest` flow:

```text
read Voice podcast/latest.json
-> read latest.metaPath
-> map meta.json to Podcast DTO
-> probe audio.oggPath with ranged GET
-> if OGG is audio/* and 2xx/206, choose OGG
-> otherwise probe audio.wavPath
-> return selected same-origin audio proxy URL
```

`GET /podcasts/daily?days=30` should scan from the latest date backward. Missing dates are omitted from the list instead of returning many empty rows.

Suggested DTO:

```ts
type PodcastStatus = "ready" | "partial" | "processing" | "missing" | "failed";

type DailyPodcast = {
  date: string;
  status: PodcastStatus;
  docUrl: string | null;
  docLinks: Record<string, string>;
  audio: {
    url: string | null;
    format: "audio/ogg" | "audio/wav" | null;
    bytes: number | null;
    source: "ogg" | "wav" | null;
  };
  counts: Record<string, number>;
  scriptChars: number | null;
  updatedAt: string | null;
  audioError: string | null;
};
```

Audio proxy behavior:

- Preserve `Content-Type`.
- Preserve range semantics where possible.
- Support browser `Range` requests.
- Return `404` when no usable audio exists.
- Avoid exposing local filesystem paths to the frontend.

## UI Design

### Companion Right Rail

Replace the current first-screen Trace card in `CompanionRightRail` overview with a compact Daily Podcast card.

The card shows:

- latest date
- status chip
- compact play/pause control
- selected audio format
- Feishu document link
- `/podcasts` list entry
- refresh action

The right rail card does not show the 30-day list.

Trace and runtime health pages remain available through existing topbar or tools navigation. The first-screen overview should prioritize the daily podcast entry.

### `/podcasts` Page

Use the A visual direction from the generated mockup, with a restrained implementation:

- dark HUD page background
- no full starfield
- no decorative orbs
- cyan edge light only where it clarifies structure
- card radius no more than 8px
- dense but readable content layout

Layout:

```text
Top bar
  Daily Podcast
  Back to Companion
  Refresh

Main upper area
  Latest Podcast player
  Status and document column

Main lower area
  Recent 30 Days list
```

Recent list row fields:

- date
- status
- audio format
- doc link
- play action
- expand action

Expanded row fields:

- `docLinks`
- `counts`
- `scriptChars`
- `audioError`
- meta/debug source status

## Waveform Player

The latest panel uses a real Canvas waveform driven by the selected podcast audio.

Pipeline:

```text
same-origin audio URL
-> fetch audio bytes
-> AudioContext.decodeAudioData
-> compute peaks
-> draw waveform on Canvas
```

Rendering layers:

```text
unplayed waveform: low-light blue gray
played waveform: cyan highlight with light glow
cursor: thin vertical line plus current time
```

Interaction:

```text
click canvas -> seek to pointer position
pointerdown + pointermove -> drag seek
pointerup -> release drag
playback -> requestAnimationFrame reads audio.currentTime and redraws progress
```

Implementation notes:

- `<audio>` owns playback state.
- Canvas owns visualization and seek gestures only.
- Use Pointer Events so mouse and touch share one path.
- Compute peaks once per audio URL and cache in component state.
- On resize, redraw from cached peaks instead of decoding again.
- OGG is preferred for waveform generation because the current podcast OGG is much smaller than WAV.
- If fallback WAV is selected, playback should remain immediately available and waveform generation may be delayed.
- If decode fails, keep playback available and show a non-blocking waveform error state.

Historical rows should lazy-load waveform only after expansion or explicit playback.

## Status And Fallbacks

Status mapping:

```text
meta 404 -> missing
meta.ok=true + ogg/wav probe success -> ready
meta.ok=true + docUrl exists + audio unavailable -> partial or processing
meta.ok=false + docUrl exists -> partial
meta.ok=false + no docUrl -> failed
audioError exists -> partial or failed depending on available document/audio
```

UI behavior:

- `ready`: playback enabled.
- `partial`: document link enabled, playback disabled unless an audio fallback exists.
- `processing`: refresh enabled, player disabled.
- `missing`: omit from historical list; show a latest empty state only when latest is missing.
- `failed`: show error state and retain any available document/meta entry.

Audio fallback:

```text
try OGG with ranged GET
-> fallback WAV with ranged GET
-> no audio
```

Do not generate a fake waveform when no audio exists.

## Testing Strategy

Backend tests:

- `latest.json -> meta.json -> DTO` mapping.
- OGG probe success chooses OGG.
- OGG probe failure falls back to WAV.
- `meta 404`, `ok=false`, and `audioError` map to expected statuses.
- Audio proxy preserves `Content-Type`.
- Audio proxy supports range behavior.

Frontend tests:

- Companion overview renders Daily Podcast card instead of Trace card.
- `/podcasts` requests `days=30` by default.
- `ready`, `partial`, `processing`, `missing`, and `failed` states render correctly.
- Waveform click seek computes the expected `audio.currentTime`.
- Waveform drag seek updates `audio.currentTime`.
- Waveform decode failure leaves playback controls available.

Browser checks:

- `/companion` right rail shows latest podcast.
- `/podcasts` plays OGG.
- Latest waveform renders and seek works.
- Narrow viewport does not overlap text, controls, or list rows.

## Documentation Updates

When implementation begins, update:

```text
docs/architecture/current-system-topology.md
```

The topology doc should describe:

- FastAPI podcast aggregation routes.
- Voice Workflow interface 5 read relationship.
- same-origin audio proxy.
- `/companion` right rail podcast entry.
- `/podcasts` page.
- OGG preferred / WAV fallback policy for daily podcast only.

## Non-goals

This milestone does not include:

- Generating podcasts inside this project.
- Editing podcast scripts.
- Replacing the Voice Workflow service.
- Migrating all historical TTS or realtime voice outputs to OGG.
- Building a full audio editor.
- Adding user subscriptions or notifications.
- Adding a separate podcast database table unless caching becomes necessary during implementation.

## Deferred Follow-up

After Daily Podcast is implemented and verified, revisit whether older Voice Workflow audio integrations should prefer `audio/ogg` over `audio/wav`.

Do not change realtime TTS/chunk behavior until:

- Voice service format support is confirmed.
- OGG generation/transcoding latency is known.
- first-audio latency is benchmarked against the current flow.

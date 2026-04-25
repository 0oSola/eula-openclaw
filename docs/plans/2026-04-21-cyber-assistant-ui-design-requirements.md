# Cyber Assistant UI Design Requirements

## 1. Background

The current `/companion` page works functionally, but its layout still feels like a developer/debug interface: MMD stage on the left, chat and mapping controls on the right, with many controls exposed at the same visual priority.

The new direction is a tech-forward personal assistant cockpit. The page should feel like a private AI operating surface: command-first, emotionally present, visually futuristic, and centered around the MMD companion as the user's active assistant.

Reference Pencil concept:

- `Cyber Assistant Cockpit UI`
- Node ID: `p67op`
- File: `pencil-new.pen`

## 2. Product Goals

1. Make `/companion` feel like a personal assistant product, not a configuration dashboard.
2. Make the MMD character the emotional and visual center of the experience.
3. Make the message input the primary action surface.
4. Keep advanced features available, but reduce their default visual weight.
5. Preserve current functionality: chat, TTS, model switching, VMD mapping, trace access, and session handling.

## 3. Design Direction

### Visual Language

Use a high-tech cockpit aesthetic:

- Dark spatial background.
- Cyan neon as the primary system color.
- Violet as secondary accent for memory/task surfaces.
- Glass/HUD panels with subtle borders and glow.
- Central holographic assistant stage.
- Dense enough to feel technical, but not crowded.

Avoid:

- Cute mascot styling.
- Warm lifestyle assistant cards.
- Generic admin dashboard patterns.
- Large marketing hero poster layout.
- Purple-on-white default AI SaaS look.

### Mood Keywords

- Futuristic
- Personal
- Calm
- Capable
- Private
- Command-oriented
- MMD-aware

## 4. Target Page Structure

The `/companion` page should become a single cockpit-like screen.

```text
Top status bar
+-- Brand / assistant identity
+-- Live status
+-- lightweight session controls

Main cockpit
+-- Left telemetry panel
|   +-- current context
|   +-- capabilities / modes
|   +-- quick assistant modes
+-- Center assistant stage
|   +-- MMD render surface
|   +-- current emotion/action state
|   +-- model selector, visually secondary
|   +-- speaking/listening state
+-- Right mission panel
    +-- next action
    +-- memory snapshot
    +-- trace/status summary

Bottom command bar
+-- primary text input
+-- TTS / voice controls
+-- send button
+-- advanced action entry points
```

## 5. Layout Requirements

### Desktop

Use a three-zone cockpit layout:

- Left panel: fixed width, approximately `280-320px`.
- Center stage: fluid, dominant, approximately `50%` of available width.
- Right panel: fixed width, approximately `280-320px`.
- Bottom command bar spans below the main content and should be visually dominant.

The center stage must be the strongest visual region.

### Tablet

Collapse to:

```text
Center stage
Command bar
Left telemetry
Right mission panel
Advanced controls
```

### Mobile

Use a single-column interaction flow:

1. Assistant status header
2. MMD stage
3. Command input
4. Conversation history
5. Memory/task cards
6. Advanced controls collapsed into accordions

No horizontal scrolling.

## 6. Component Requirements

### 6.1 Top Status Bar

Must show:

- Assistant brand: `MIO // PERSONAL AI` or equivalent.
- Live connection state.
- Current user/session indicator.
- Link to trace page.
- Logout/session reset control.

Visual treatment:

- Thin HUD border.
- Monospace labels.
- Small glowing status dot.

### 6.2 Center Assistant Stage

Must include:

- Current MMD model render.
- Model label.
- Model selector.
- Current emotion.
- Current action.
- Speaking state.
- Loading/error state for model loading.

The MMD character should appear as the core assistant presence, not as a secondary preview.

Current implementation target:

- Refactor visual wrapper around `MMDStage`.
- Keep `MMDCompanionRuntime` unchanged unless layout constraints require runtime container changes.

### 6.3 Command Bar

The command bar is the primary user action.

Must include:

- Text input.
- Send action.
- Loading/sending state.
- TTS toggle.
- TTS mode selector.
- Optional quick action buttons.

Design details:

- Large pill or rounded capsule.
- Light surface against dark cockpit background.
- Strong send button contrast.
- Input placeholder should feel assistant-native, e.g. `Ask Mio to plan, remember, render, or act...`

### 6.4 Conversation Surface

Conversation should not dominate the whole screen by default.

Must support:

- Recent user/assistant messages.
- System/error messages.
- Trace ID display, visually secondary.
- Scrollable history when needed.

Recommended placement:

- Either below/near the command bar.
- Or inside a collapsible/side drawer labeled `Conversation`.

### 6.5 Left Telemetry Panel

Purpose: show assistant readiness and mode.

Suggested modules:

- Current context.
- Capabilities: memory, voice, MMD, trace.
- Quick modes: focus companion, anime response, task executor.

These can initially be static/derived from existing state, then become interactive later.

### 6.6 Right Mission Panel

Purpose: show what the assistant understands and will do next.

Suggested modules:

- Next action from current state.
- Memory snapshot.
- Trace/status summary.
- Last response emotion/action metadata.

This should make the assistant feel aware and persistent.

### 6.7 Advanced Controls

The existing `MappingEditor` is useful but too heavy for the default assistant page.

Requirement:

- Move mapping/VMD controls into a collapsed advanced panel, drawer, or secondary tab.
- Do not show full mapping editor at primary page weight by default.
- Keep preview behavior available.

## 7. Data Mapping Requirements

Reuse current frontend state:

| UI Area | Existing State / Source |
| --- | --- |
| User/session | `loadSession()`, `session.userId`, `sessionId` |
| MMD model | `models`, `selectedModelPath`, `selectedModel`, `modelLabel` |
| Assistant status | `interaction.emotion`, `interaction.action`, `interaction.mode` |
| Speaking | `speaking`, `ttsEnabled`, `ttsMode` |
| Chat | `messages`, `input`, `loading`, `error` |
| Trace | `response.trace_id`, `/traces` link |
| Memory/task summary | derived initially from last messages and interaction state |
| VMD/mapping | `mappings`, `assets`, `MappingEditor` |

No backend API changes are required for the first visual implementation.

## 8. Visual Tokens

Recommended CSS variables:

```css
:root {
  --cyber-bg: #030812;
  --cyber-surface: rgba(7, 16, 27, 0.82);
  --cyber-surface-strong: rgba(8, 23, 36, 0.92);
  --cyber-border: rgba(31, 231, 255, 0.28);
  --cyber-border-soft: rgba(31, 231, 255, 0.16);
  --cyber-text: #eafbff;
  --cyber-muted: #8ea9b5;
  --cyber-cyan: #00e5ff;
  --cyber-green: #56ffb6;
  --cyber-violet: #8b5cff;
  --cyber-danger: #ff6b8a;
}
```

Typography:

- Headings: `Geist`, `Space Grotesk`, or current heading font fallback.
- UI labels: monospace style, currently acceptable via `IBM Plex Mono` if imported.
- Body: current Chinese-capable sans font must remain available for Chinese text.

## 9. Interaction Requirements

### Sending Message

1. User enters text in command bar.
2. Send button enters loading state.
3. Message appears in history.
4. Assistant response updates:
   - conversation history,
   - central emotion/action chips,
   - MMD interaction state,
   - TTS state if enabled.

### Error Handling

Errors must be visible but not visually catastrophic.

Show:

- API/chat errors near command bar.
- Model loading errors inside the stage.
- TTS fallback state if server TTS is unavailable.

### Loading States

Required loading states:

- Initial session loading.
- MMD model loading.
- Model catalog loading/failure.
- Chat request loading.
- Mapping/VMD asset loading where applicable.

## 10. Accessibility Requirements

- All inputs and buttons must have accessible labels.
- Neon styling must not reduce text contrast.
- Focus states must be visible.
- The command input must be keyboard-first.
- Send via `Enter` can be added later, but must not break multiline input unless explicitly designed.
- Motion/glow effects should respect reduced motion if animation is added.

## 11. Implementation Scope

### In Scope

- Redesign `/companion` layout.
- Update `web/src/app/globals.css` with cyber cockpit tokens and classes.
- Refactor `web/src/app/companion/page.tsx` markup.
- Adjust `MMDStage` wrapper styling if needed.
- Collapse or visually demote `MappingEditor`.
- Preserve current API calls and state flow.

### Out of Scope

- New backend endpoints.
- New authentication system.
- Persistent memory summarization backend.
- Real-time WebSocket streaming.
- Replacing MMD runtime.
- New 3D effects beyond CSS/container styling.

## 12. Acceptance Criteria

The redesign is acceptable when:

1. `/companion` visually reads as a futuristic personal assistant cockpit.
2. MMD stage is the dominant visual region.
3. Command bar is the obvious primary action.
4. Chat, TTS, model switching, trace link, and mapping/VMD features remain usable.
5. Advanced mapping controls no longer dominate the default page.
6. Desktop layout works at `1440x900`.
7. Tablet and mobile layouts do not require horizontal scrolling.
8. Existing basic checks pass:

```powershell
npm --prefix web run check:basic
```

9. Existing MMD runtime tests pass:

```powershell
npm exec --prefix web -- node --test web/tests/mmd-render-runtime.test.mjs
```

10. Existing resolver/trace tests pass:

```powershell
npm exec --prefix web -- node --test web/tests/resolver-and-trace.test.mjs
```

## 13. Suggested Implementation Order

1. Add CSS variables and cockpit layout classes.
2. Refactor `/companion` into top bar, cockpit main area, and command bar.
3. Move chat form into command bar.
4. Keep conversation history in a secondary panel.
5. Restyle `MMDStage` as the central assistant core.
6. Move `MappingEditor` behind an advanced disclosure.
7. Add responsive layout rules.
8. Run the verification commands listed above.

## 14. Open Decisions

1. Assistant brand name: keep `Mio`, `MIO`, or choose a project-specific name.
2. Conversation placement: right drawer vs below command bar vs right mission panel.
3. Mapping editor behavior: accordion vs modal vs separate route.
4. Whether model selector should be always visible or hidden under stage settings.
5. Whether the interface should support a later "full-screen stage mode."

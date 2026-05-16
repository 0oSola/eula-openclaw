# PWA-first Mobile Design

Date: 2026-05-17

## Summary

The first mobile milestone extends the current `/companion` experience into an installable iPhone/iPad PWA while keeping the existing Next.js, FastAPI, Three.js, MMD, VMD, OpenClaw, and TTS architecture intact.

The agreed direction is PWA-first, not native-first. iPhone and iPad both default to the full MMD experience. A separate light MMD quality profile is added for low-end devices and manual user opt-in. Apple Watch, push notifications, native iOS shells, offline chat, and native rendering rewrites are explicitly out of scope for this milestone.

## Confirmed Decisions

- Use `PWA-first + Watch companion later` as the platform strategy.
- First milestone targets iPhone and iPad only.
- Keep `/companion` as the shared route. Do not add `/companion/mobile`.
- iPhone and iPad default to full MMD rendering.
- Add a light MMD mode for all low-end devices and manual user control.
- Light mode only reduces rendering cost. It does not change VMD playback, click interactions, chat-triggered actions, idle loops, or the stage interaction state machine.
- Low-performance detection only prompts the user to enable light mode. It never auto-switches.
- Add installable PWA support, an offline shell, and a developer-selected bundled default resource pack.
- The bundled pack supports one default character and a small set of motions.
- The bundled resource source directory structure and examples are committed, but real PMX/VMD/texture assets are ignored by git.
- Default backend access continues through the Next.js same-origin `/api/backend/*` proxy.
- Keep a future direct-public-backend configuration boundary.
- Continue using the current lightweight `userId`/session model.
- iPhone uses a stage-first layout with a three-position chat drawer.
- Offline mode can display the bundled character and bundled idle motion, but disables chat, TTS, and dynamic resources.
- Bundled resources are shown separately from backend resources in the resource selector.
- Bundled resources do not participate in OpenClaw motion resolution or backend `asset_registry` in this milestone.
- Do not implement push notifications in this milestone. Only reserve the boundary in design.

## Architecture

The current runtime shape remains:

```text
PWA / Browser
  -> Next.js UI
  -> Next.js same-origin /api/backend/* proxy
  -> FastAPI API
  -> OpenClaw / TTS / SQLite / MMD_ROOT_DIR
```

The default mobile PWA must not know the FastAPI private address. It calls `/api/backend/*` exactly like the current browser UI. Next.js remains responsible for forwarding to FastAPI through deployment environment configuration.

The frontend API layer should still leave room for a future direct backend transport:

```text
backendTransport = "next-proxy" | "direct"
```

For this milestone, `next-proxy` is the only enabled/default mode. `direct` is a reserved shape for future public HTTPS FastAPI deployments, CORS, WebSocket auth, and public TTS proxy routing.

Rendering style and rendering cost are separate axes:

```text
renderPipeline        = "classic" | "hero-shot" | "genshin" | "mio-reference" | "reze-npr"
renderQualityProfile  = "full" | "light"
```

This keeps current render modes isolated. For example, `mio-reference + light` and `reze-npr + light` are valid combinations without redefining what `mio-reference` or `reze-npr` mean.

## Mobile UX

iPad keeps a layout close to the desktop experience: stage, chat, and controls remain visible in a broad workspace. The main work is touch sizing, viewport height handling, safe-area insets, orientation behavior, and avoiding text/control overlap.

iPhone uses a stage-first layout. The first screen is dominated by the MMD stage, with chat placed in a bottom drawer. The drawer has three states:

```text
collapsed -> half -> expanded
```

`collapsed` is the default. It exposes only a small chat entry or recent-message preview while preserving the character-first experience. `half` supports reading and sending messages while keeping the stage visible. `expanded` is for focused reading and text input.

Mobile controls move out of the main stage area. Render pipeline selection, light MMD toggle, resource source selection, model/motion selection, and camera controls should live in a bottom panel or drawer-style settings surface on iPhone.

The mobile implementation should reuse the existing `/companion` page state, `MMDStage`, `MMDCompanionRuntime`, and stage interaction machine. It should not fork a separate mobile business flow.

## Light MMD Quality Profile

Light mode is a quality profile, not a new render style. It is available on every render pipeline and can be manually enabled by the user.

The first implementation should reduce render cost only:

- Lower device pixel ratio / renderer pixel ratio.
- Reduce or disable high-cost shadows.
- Reduce postprocessing cost.
- Disable or reduce bloom where needed.
- Simplify outline cost or lower outline quality.
- Reduce texture sampling cost such as anisotropy.

The following must remain unchanged:

- PMX model loading semantics.
- VMD playback.
- Idle loop selection.
- Chat action resolution.
- Stage click interaction behavior.
- Motion completion/error recovery.
- `stageInteractionMachine` modes and transitions.

Low-performance detection starts after initial model loading has stabilized. It uses recent FPS/frame-time samples plus basic device signals such as mobile Safari, DPR, screen size, and `navigator.deviceMemory` when available.

The detection result only shows a non-blocking toast/banner. The user can enable light mode from that prompt or ignore it. Ignoring suppresses repeated prompts for the current session. The user's explicit full/light preference is stored locally and restored later.

## PWA Shell

The PWA milestone includes:

- Web app manifest.
- App icons.
- Mobile viewport and safe-area support.
- Service worker.
- Offline shell.
- Clear offline/backend-unavailable UI state.

The service worker should precache the application shell and selected bundled resource pack metadata. Large bundled resource files are cached only when the selected pack configuration says they should be available offline.

This milestone does not implement offline chat, offline message queues, or automatic replay after reconnect.

## Bundled MMD Resource Pack

Bundled resources come from an explicit developer-managed source directory, not from a broad scan of `MMD_ROOT_DIR`.

Suggested source layout:

```text
pwa-mmd-packs/
  default-eula/
    pack.json
    models/
    motions/
    textures/
    thumbnails/
```

The repository should commit only:

- Directory placeholders.
- `pack.example.json`.
- Schema or validation documentation.
- Usage instructions.

Real PMX, VMD, texture, and thumbnail assets are excluded with `.gitignore`. Developers place assets locally when they want a bundled pack.

Build selection is explicit:

```env
PWA_BUNDLED_MMD_PACK=default-eula
```

The build helper validates `pack.json`, verifies referenced files, calculates `size_bytes` and `sha256`, copies the selected pack to:

```text
web/public/mmd-packs/<pack-id>/
```

and writes a frontend-readable pack index.

First milestone resource scope:

- One default character.
- One idle motion.
- A small number of basic motions.
- Optional thumbnail/preview assets.

## Pack Manifest

The manifest describes model, motions, offline defaults, and integrity metadata.

Example shape:

```json
{
  "pack_id": "default-eula",
  "display_name": "Default Eula",
  "version": "1.0.0",
  "license_note": "Developer supplied assets. Verify redistribution rights before release.",
  "model": {
    "name": "Eula",
    "entry": "models/eula/model.pmx",
    "display_name": "Eula"
  },
  "motions": {
    "idle": ["motions/idle_loop.vmd"],
    "basic": ["motions/greeting.vmd"]
  },
  "offline_default": {
    "model": "models/eula/model.pmx",
    "idle_motion": "motions/idle_loop.vmd"
  },
  "files": [
    {
      "path": "models/eula/model.pmx",
      "size_bytes": 123456,
      "sha256": "..."
    }
  ]
}
```

The final schema should reject missing paths, duplicate paths, unsafe path traversal, missing offline defaults, and mismatched hashes when hashes already exist.

## Resource Selection

The frontend resource selector should show two source groups:

```text
Bundled resource packs
Backend resource library
```

Online behavior:

- Bundled packs are selectable.
- Backend resources from FastAPI `/assets/mmd/*` and `/assets/vmd/*` are selectable.

Offline or backend-unavailable behavior:

- Bundled packs remain selectable if precached.
- Backend resources are disabled or hidden with a clear unavailable state.

Bundled pack resources are not registered into backend `asset_registry`. They do not participate in OpenClaw motion resolution or backend favorite VMD matching in this milestone. Online chat actions continue to use existing backend `motion_resolution`.

## Offline Display Mode

When the PWA shell is available but the backend is offline or unreachable, the app enters offline display mode if a bundled pack is available.

Offline display mode:

- Loads the bundled default model.
- Plays the bundled default idle motion.
- Disables message sending.
- Disables TTS.
- Disables dynamic backend resource browsing.
- Shows a clear offline/backend-unavailable state.
- Recovers to normal online mode after network and backend checks succeed.

If no bundled pack is configured or cached, the offline shell still opens but shows the unavailable state without a character stage.

## Identity And Session

This milestone keeps the current lightweight identity model:

- Local `userId`.
- Local active session.
- Local UI preferences.
- Existing `x-user-id` request header behavior.
- Existing `?user_id=` query support where browser APIs cannot attach headers, such as audio URLs.

No formal login, token refresh, device pairing, account migration, or Watch pairing flow is added in this milestone.

## Apple Watch Boundary

Apple Watch is not implemented in this milestone.

The long-term direction is a thin SwiftUI companion, not full MMD rendering on watchOS. The Watch companion should use WatchConnectivity with a paired iPhone app for quick actions, notifications, play/pause, session controls, short text/voice input, and status display.

The watchOS app must not be treated as a target for full WebGL/MMD rendering.

## Notifications Boundary

Push notifications are not implemented in this milestone.

The design leaves room for future notification support, but avoids introducing:

- VAPID keys.
- Push subscription storage.
- Notification permission UI.
- Backend push jobs.
- Delivery/retry semantics.

## Error Handling

The user-facing error states should be explicit:

- Service worker shell loaded, backend unavailable.
- Bundled pack missing.
- Bundled pack manifest invalid.
- Bundled pack file missing.
- Bundled pack integrity mismatch.
- Backend resource library unavailable.
- Low-performance warning available.
- Light mode enabled/disabled.

Runtime behavior should favor graceful degradation:

- If backend resources fail but bundled resources are available, keep the bundled stage usable.
- If bundled resources fail, keep chat/backend UI usable when online.
- If low-performance detection triggers, prompt only once per session unless the user changes quality settings.
- If service worker cache is stale, prefer clear reload/update messaging over silent broken assets.

## Testing Strategy

Unit and integration tests should cover:

- `renderQualityProfile` normalization and persistence.
- Quality profile selection independent from `renderPipeline`.
- Low-performance detector threshold behavior and prompt suppression.
- Backend transport config defaulting to `next-proxy`.
- Bundled pack manifest validation.
- Safe path validation for bundled pack files.
- Resource selector grouping for bundled vs backend resources.
- Offline display mode state selection.
- Disabled chat/TTS behavior when offline.

Browser/E2E tests should cover:

- iPhone viewport starts with stage-first layout and collapsed chat drawer.
- Chat drawer transitions through collapsed, half, and expanded.
- Light MMD toggle is reachable on mobile.
- Low-performance prompt can enable light mode.
- PWA manifest is served.
- Service worker registers in production-like mode.
- Offline shell displays a clear offline state.
- Bundled default pack appears when configured.

Manual verification should include:

- iPhone Safari Add to Home Screen.
- iPad Safari layout in portrait and landscape.
- Cold start with full MMD.
- Manual switch to light MMD.
- Backend offline startup with bundled pack.
- Backend recovery after offline mode.

## Non-goals

This milestone does not include:

- Apple Watch implementation.
- SwiftUI app or `ios/` project creation.
- Capacitor shell.
- App Store packaging.
- Native Metal renderer.
- WebGPU renderer migration.
- Offline chat.
- Offline message queue or replay.
- Push notifications.
- Formal login/auth tokens.
- Device pairing.
- Automatic caching of recently used backend resources.
- Multiple bundled characters.
- Full offline motion library.
- Bundled resources in backend `asset_registry`.
- Bundled resources in OpenClaw motion matching.
- Changes to existing MMD/VMD action semantics.

## External References

- Apple Home Screen web apps: https://support.apple.com/en-euro/guide/iphone/iphea86e5236/ios
- Apple Web Push for web apps: https://developer.apple.com/documentation/UserNotifications/sending-web-push-notifications-in-web-apps-and-browsers
- WatchConnectivity: https://developer.apple.com/documentation/WatchConnectivity
- WKWebView availability: https://developer.apple.com/documentation/webkit/wkwebview

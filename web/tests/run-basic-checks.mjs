import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { BUILT_IN_VMD_PLAYBACK_RATE, DEFAULT_VMD_PLAYBACK_RATE } from "../src/features/stage/builtInMotionPreferences.js";
import {
  buildAutoFavoriteInteraction,
  buildAutoplayResumeInteraction,
  createDefaultFavoriteLoopInteraction,
  resolveVmdPlaybackRate,
} from "../src/features/mapping/vmdPreview.js";
import { collectImportableVmdFiles } from "../src/features/stage/vmdImportHelpers.js";
import {
  createStageClickRipple,
  resolveStageCharacterClickInteraction,
  shouldTriggerStageCharacterClick,
} from "../src/features/stage/stageCharacterClick.js";
import {
  completeStageInteraction,
  createDefaultStageInteraction,
  resetStageInteraction,
  startChatInteraction,
  startStageClickInteraction,
  startManualPreview,
} from "../src/features/stage/stageInteractionMachine.js";
import { resolveActionConfig, resolvePlaybackPlan } from "../src/features/mapping/resolveAction.js";
import { buildTraceHeaders } from "../src/lib/trace.js";

function run() {
  {
    const webRoot = fileURLToPath(new URL("../", import.meta.url));
    const result = spawnSync(process.execPath, ["./scripts/run-next.mjs", "build", "--help"], {
      cwd: webRoot,
      encoding: "utf8",
    });

    assert.equal(
      result.status,
      0,
      `run-next wrapper should launch Next CLI without Windows spawn errors.\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
    assert.match(`${result.stdout}\n${result.stderr}`, /next(?:\s+build)?/i);
  }

  {
    const commandBarSource = readFileSync(new URL("../src/app/companion/CompanionCommandBar.tsx", import.meta.url), "utf8");
    const companionPageSource = readFileSync(new URL("../src/app/companion/page.tsx", import.meta.url), "utf8");
    const chatboxSource = readFileSync(new URL("../src/app/companion/CompanionChatbox.tsx", import.meta.url), "utf8");
    const rightRailSource = readFileSync(new URL("../src/app/companion/CompanionRightRail.tsx", import.meta.url), "utf8");
    const typesSource = readFileSync(new URL("../src/lib/types.ts", import.meta.url), "utf8");
    const apiSource = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");
    const waveformSource = readFileSync(new URL("../src/app/podcasts/PodcastWaveform.tsx", import.meta.url), "utf8");
    const realtimeVoiceQueueSource = readFileSync(
      new URL("../src/lib/realtimeVoiceQueue.js", import.meta.url),
      "utf8",
    );
    const backendProxySource = readFileSync(new URL("../src/app/api/backend/[...path]/route.ts", import.meta.url), "utf8");
    const backgroundSource = readFileSync(new URL("../src/app/companion/MioModeBackground.tsx", import.meta.url), "utf8");
    const stageSource = readFileSync(new URL("../src/features/stage/MMDStage.tsx", import.meta.url), "utf8");
    const cssSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");
    const runtimeSource = readFileSync(new URL("../src/features/stage/mmdCompanionRuntime.js", import.meta.url), "utf8");

    assert.match(commandBarSource, /export function CompanionCommandBar/);
    assert.doesNotMatch(commandBarSource, /ttsNotice: string/);
    assert.doesNotMatch(commandBarSource, /className="mio-notice"/);
    assert.match(commandBarSource, /mio-command-shell/);
    assert.match(companionPageSource, /<CompanionCommandBar/);
    assert.match(typesSource, /tts\?:\s*\{/);
    assert.match(typesSource, /status:\s*"loading"\s*\|\s*"pending"\s*\|\s*"ready"\s*\|\s*"failed"\s*\|\s*"expired"\s*\|\s*"partial_failed"/);
    assert.match(typesSource, /export type RealtimeVoiceStatus/);
    assert.match(typesSource, /export type MessageServiceCleanupResult = \{/);
    assert.match(typesSource, /export type MessageBridgeStatus = \{/);
    assert.match(typesSource, /export type DailyPodcast/);
    assert.match(chatboxSource, /onPlayTtsMessage: \(message: ChatMessage\) => void;/);
    assert.match(chatboxSource, /className="mio-message-voice-button"/);
    assert.match(chatboxSource, /className="mio-chatbox-list"/);
    assert.match(chatboxSource, /className="mio-chatbox-message-flow"/);
    assert.doesNotMatch(chatboxSource, /useVirtualizer/);
    assert.doesNotMatch(chatboxSource, /getVirtualItems\(\)/);
    assert.doesNotMatch(chatboxSource, /mio-chatbox-virtual-row/);
    assert.match(chatboxSource, /className="mio-chatbox-controls"/);
    assert.match(chatboxSource, /showTools \? "Hide" : "Tools"/);
    assert.match(chatboxSource, /onCreateSession: \(\) => void;/);
    assert.match(rightRailSource, /onPlayTtsMessage=\{onPlayTtsMessage\}/);
    assert.match(rightRailSource, /sessions=\{sessions\}/);
    assert.match(companionPageSource, /function updateMessageTts\(/);
    assert.match(apiSource, /export async function getLatestMotionContextExport\(/);
    assert.match(apiSource, /export async function updateChatSession\(/);
    assert.match(apiSource, /export async function deleteChatSession\(/);
    assert.match(apiSource, /export async function cleanupMessageServiceAdmin\(/);
    assert.match(apiSource, /export async function getMessageBridgeStatus\(/);
    assert.match(apiSource, /export async function patchMessageBridgeSettings\(/);
    assert.match(apiSource, /export async function listMessageBridgeFeishuSessions\(/);
    assert.match(apiSource, /export async function setDefaultMessageBridgeBinding\(/);
    assert.match(apiSource, /export async function getLatestDailyPodcast/);
    assert.match(apiSource, /export async function listDailyPodcasts/);
    assert.match(apiSource, /export async function getDailyPodcast/);
    assert.match(waveformSource, /<canvas/);
    assert.match(waveformSource, /decodeAudioData/);
    assert.match(waveformSource, /requestAnimationFrame/);
    assert.match(waveformSource, /onPointerDown/);
    assert.match(waveformSource, /setPointerCapture/);
    assert.match(waveformSource, /seekTimeFromPointer/);
    assert.match(apiSource, /function resolveRuntimeApiBaseUrl\(/);
    assert.match(apiSource, /runtimeHostname !== "localhost"/);
    assert.match(apiSource, /API request failed before reaching backend/);
    assert.match(apiSource, /\/api\/backend/);
    assert.match(apiSource, /sessionVoiceWebSocketUrl/);
    assert.match(realtimeVoiceQueueSource, /export function sessionVoiceWebSocketUrl/);
    assert.match(realtimeVoiceQueueSource, /export class AudioQueue/);
    assert.match(realtimeVoiceQueueSource, /manual_after_partial_playback/);
    assert.match(realtimeVoiceQueueSource, /auto_before_playback/);
    assert.match(backendProxySource, /export async function GET/);
    assert.match(backendProxySource, /proxyBackendRequest/);
    assert.match(backendProxySource, /NEXT_PUBLIC_API_BASE_URL/);
    assert.match(backendProxySource, /await response\.arrayBuffer\(\)/);
    assert.match(companionPageSource, /const MESSAGE_BRIDGE_POLL_INTERVAL_MS = 2500;/);
    assert.match(companionPageSource, /async function refreshActiveSessionMessages\(/);
    assert.match(companionPageSource, /function driveCharacterFromBridgeMessage\(/);
    assert.match(companionPageSource, /setInterval\(\(\) => \{/);
    assert.match(companionPageSource, /handleMessageBridgeBindingSwitch/);
    assert.match(companionPageSource, /async function openBridgeBoundChatSession\(/);
    assert.match(companionPageSource, /async function applyMessageBridgeBinding\(/);
    assert.match(companionPageSource, /await applyMessageBridgeBinding\(messageBridgeSelectedSessionKey/);
    assert.match(companionPageSource, /const bridgeMessage = await applyMessageBridgeBinding\(messageBridgeSelectedSessionKey/);
    assert.match(companionPageSource, /status\.binding \|\| binding/);
    assert.match(companionPageSource, /Open Bridge Chat/);
    assert.match(companionPageSource, /messageBridgeSessions\.map/);
    assert.match(companionPageSource, /Bridge Session/);
    assert.match(companionPageSource, /function formatMessageBridgeSessionLabel\(/);
    assert.match(companionPageSource, /agent:main:feishu:direct:ou_229011826b88e09badbbb6f43ad38ba3/);
    assert.match(companionPageSource, /external_session_key\.split\(":"\)\.slice\(-2\)\.join\(":"\)/);
    assert.match(companionPageSource, /const loadLatestMotionContextExport = useCallback\(async \(\) => \{/);
    assert.match(companionPageSource, /void loadLatestMotionContextExport\(\)\.catch\(\(\) => \{/);
    assert.match(companionPageSource, /className="mio-advanced-json-preview"/);
    assert.match(companionPageSource, /data-testid="mio-motion-context-json"/);
    assert.match(companionPageSource, /const \[chatSessions, setChatSessions\] = useState<MessageServiceSession\[\]>\(\[\]\)/);
    assert.match(companionPageSource, /async function handleCreateSession\(/);
    assert.match(companionPageSource, /async function handleRenameSession\(/);
    assert.match(companionPageSource, /async function handleDeleteSession\(/);
    assert.match(companionPageSource, /async function handleMessageServiceCleanup\(/);
    assert.match(companionPageSource, /async function prepareAndPlayAssistantTts\(/);
    assert.match(companionPageSource, /sessionVoiceWebSocketUrl/);
    assert.match(companionPageSource, /new \w*AudioQueue/);
    assert.match(companionPageSource, /voiceSocketRef/);
    assert.match(companionPageSource, /audioQueueRef/);
    assert.match(companionPageSource, /realtimeVoiceStatus/);
    assert.match(companionPageSource, /partial_failed/);
    assert.match(companionPageSource, /cancelRealtimeVoicePlayback[\s\S]*?scope:\s*"all"/);
    const onSubmitBlock = companionPageSource.match(/async function onSubmit[\s\S]*?\n  function handleCharacterSwitch/)?.[0] || "";
    assert.doesNotMatch(onSubmitBlock, /cancelRealtimeVoicePlayback\(/);
    assert.match(companionPageSource, /async function playMessageAudio\(message: ChatMessage\)/);
    assert.match(companionPageSource, /const latestAssistantMessage = \[\.\.\.messages\]\.reverse\(\)\.find\(\(item\) => item\.role === "assistant"\)/);
    assert.match(companionPageSource, /className="mio-dialogue-voice-button"/);
    assert.match(companionPageSource, /className="mio-dialogue-copy"/);
    assert.match(companionPageSource, /onClick=\{\(\) => playMessageAudio\(latestAssistantMessage\)\}/);
    assert.match(companionPageSource, /const \[toast, setToast\] = useState/);
    assert.match(companionPageSource, /ignoreNextStageCompletionResetRef = useRef\(false\)/);
    assert.match(companionPageSource, /function handleTtsFailure\(message: string\)/);
    assert.match(companionPageSource, /className="mio-toast-layer"/);
    assert.match(companionPageSource, /className="mio-toast"/);
    assert.doesNotMatch(companionPageSource, /<form className="mio-command-bar"/);
    assert.match(
      companionPageSource,
      /const optimisticUserMessageId = createMessageId\("user-pending"\);[\s\S]*?setMessages\(\(prev\) => \[\.\.\.prev, optimisticUserMessage\]\);[\s\S]*?const response = await postSessionMessage\([\s\S]*?const userMessage = mapServerMessageToChatMessage\(response\.user_message\);[\s\S]*?const assistantMessage = mapServerMessageToChatMessage\(response\.assistant_message\);[\s\S]*?setMessages\(\(prev\) => \[[\s\S]*?message\.id !== optimisticUserMessageId[\s\S]*?assistantMessage,[\s\S]*?\]\);[\s\S]*?try\s*\{\s*await prepareAndPlayAssistantTts\(assistantMessage\);[\s\S]*?\}\s*catch\s*\(speakError\)/,
    );
    assert.match(companionPageSource, /catch\s*\(err\)\s*\{[\s\S]*?pushToast\(/);
    assert.doesNotMatch(companionPageSource, /发送失败，请检查 API 服务状态和配置/);
    assert.match(companionPageSource, /if \(ignoreNextStageCompletionResetRef\.current\) \{/);
    const stageErrorBlock = companionPageSource.match(/function handleStageInteractionError\([\s\S]*?\n  \}/)?.[0] || "";
    assert.match(stageErrorBlock, /resumeStageAfterInteractionComplete\(\)/);
    assert.doesNotMatch(stageErrorBlock, /scheduleStageActionRecovery|markStageInteractionRecovering/);
    assert.match(companionPageSource, /function handleStageCharacterClick\(/);
    assert.match(companionPageSource, /resolveStageCharacterClickInteraction/);
    assert.match(companionPageSource, /startStageClickInteraction/);
    assert.match(companionPageSource, /clickRipples=\{stageClickRipples\}/);
    assert.match(stageSource, /onCharacterClick\?:/);
    assert.match(stageSource, /hitTestModelAtClientPoint/);
    assert.match(stageSource, /mio-stage-click-ripples/);
    assert.match(backgroundSource, /type MioModeBackgroundProps = \{[\s\S]*speaking: boolean;[\s\S]*emotion: string;[\s\S]*action: string;[\s\S]*\}/);
    assert.match(backgroundSource, /data-speaking=\{speaking \? "true" : "false"\}/);
    assert.match(backgroundSource, /data-emotion=\{emotion\}/);
    assert.match(backgroundSource, /data-action=\{action\}/);
    assert.match(backgroundSource, /data-activity=\{activityPulse > 0 \? "pulse" : "idle"\}/);
    assert.match(backgroundSource, /data-time-tone=\{timeTone\}/);
    assert.match(backgroundSource, /activityPulse: number;/);
    assert.match(backgroundSource, /mio-background-stars/);
    assert.match(backgroundSource, /mio-background-star/);
    assert.match(backgroundSource, /mio-background-particles/);
    assert.match(backgroundSource, /LIGHT_PILLAR_SPEC/);
    assert.match(backgroundSource, /vertical_cyan_light_columns/);
    assert.match(backgroundSource, /soft cyan bloom/);
    assert.match(backgroundSource, /mio-background-meteors/);
    assert.match(backgroundSource, /mio-background-meteor/);
    assert.match(backgroundSource, /mio-background-reflection/);
    assert.match(backgroundSource, /mio-background-moonlight/);
    assert.match(backgroundSource, /mio-background-caustics/);
    assert.match(backgroundSource, /mio-background-nebula/);
    assert.match(backgroundSource, /mio-background-clouds/);
    assert.match(backgroundSource, /mio-background-cloud mio-background-cloud-one/);
    assert.match(backgroundSource, /mio-background-light-pillars/);
    assert.match(backgroundSource, /mio-background-light-pillar mio-background-light-pillar-one/);
    assert.match(backgroundSource, /mio-background-backlight/);
    assert.match(backgroundSource, /mio-background-voice-ripples/);
    assert.match(backgroundSource, /mio-background-ripple mio-background-ripple-one/);
    assert.match(backgroundSource, /mio-background-ripple mio-background-ripple-two/);
    assert.match(backgroundSource, /mio-background-orbiters/);
    assert.match(backgroundSource, /mio-background-orbiter mio-background-orbiter-one/);
    assert.doesNotMatch(backgroundSource, /mio-background-ring-three/);
    assert.match(backgroundSource, /mio-background-ring-scans/);
    assert.match(backgroundSource, /mio-background-ring-scan mio-background-ring-scan-one/);
    assert.doesNotMatch(backgroundSource, /mio-background-ring-scan-three/);
    assert.match(backgroundSource, /mio-background-send-wave" key=\{activityPulse\}/);
    assert.match(backgroundSource, /mio-background-emotion-particles/);
    assert.match(backgroundSource, /mio-background-foreground-particles/);
    assert.match(backgroundSource, /mio-background-stage-trails/);
    assert.match(backgroundSource, /travel:/);
    assert.match(backgroundSource, /kind:/);
    assert.match(backgroundSource, /glow:/);
    assert.doesNotMatch(backgroundSource, /kind:\s*"petal"/);
    assert.match(companionPageSource, /const \[backgroundActivityPulse, setBackgroundActivityPulse\] = useState\(0\)/);
    assert.match(companionPageSource, /setBackgroundActivityPulse\(\(current\) => current \+ 1\)/);
    assert.match(companionPageSource, /<MioModeBackground[\s\S]*active=\{renderPipeline === "mio-reference"\}[\s\S]*speaking=\{speaking\}[\s\S]*emotion=\{interaction\.emotion\}[\s\S]*action=\{interaction\.action\}[\s\S]*activityPulse=\{backgroundActivityPulse\}/);
    assert.match(cssSource, /\.mio-command-shell/);
    assert.match(cssSource, /\.mio-command-surface/);
    assert.match(cssSource, /\.mio-toast-layer/);
    assert.match(cssSource, /\.mio-toast/);
    assert.match(cssSource, /\.mio-background\[data-speaking="true"\]/);
    assert.match(cssSource, /\.mio-background\[data-emotion="happy"\]/);
    assert.match(cssSource, /\.mio-background\[data-action="wave"\]/);
    assert.doesNotMatch(backgroundSource, /mio-background-sweep/);
    assert.doesNotMatch(cssSource, /\.mio-background-sweep/);
    assert.doesNotMatch(cssSource, /@keyframes mio-background-sweep/);
    assert.match(cssSource, /\.mio-background\[data-action="idle"\] \.mio-background-aura/);
    assert.match(cssSource, /\.mio-background\[data-action="idle"\] \.mio-background-circle/);
    assert.match(cssSource, /\.mio-background\[data-action="idle"\] \.mio-background-particle/);
    assert.match(cssSource, /@keyframes mio-idle-circle-swell/);
    assert.match(cssSource, /\.mio-background-stars/);
    assert.match(cssSource, /\.mio-background-star/);
    assert.match(cssSource, /\.mio-background-meteors/);
    assert.match(cssSource, /\.mio-background-meteor/);
    assert.match(cssSource, /\.mio-background-meteor::before/);
    assert.match(cssSource, /\.mio-background-meteor::after/);
    assert.match(cssSource, /\.mio-background-reflection/);
    assert.match(cssSource, /\.mio-background-moonlight/);
    assert.match(cssSource, /\.mio-background-caustics/);
    assert.match(cssSource, /\.mio-background-nebula/);
    assert.match(cssSource, /\.mio-background-clouds/);
    assert.match(cssSource, /\.mio-background-cloud/);
    assert.match(cssSource, /\.mio-background-light-pillars/);
    assert.match(cssSource, /\.mio-background-light-pillar/);
    assert.match(cssSource, /\.mio-background-backlight/);
    assert.match(cssSource, /\.mio-background-voice-ripples/);
    assert.match(cssSource, /\.mio-background-ripple/);
    assert.match(cssSource, /\.mio-background\[data-speaking="true"\] \.mio-background-ripple/);
    assert.match(cssSource, /\.mio-background-orbiters/);
    assert.match(cssSource, /\.mio-background-orbiter/);
    assert.match(cssSource, /\.mio-background-ring-scans/);
    assert.match(cssSource, /\.mio-background-ring-scan/);
    assert.doesNotMatch(cssSource, /\.mio-background-ring-scan-three/);
    assert.doesNotMatch(cssSource, /\.mio-background-ring-three/);
    assert.doesNotMatch(cssSource, /@keyframes mio-ring-breathe/);
    assert.match(cssSource, /\.mio-background-send-wave/);
    assert.match(cssSource, /\.mio-background\[data-activity="pulse"\] \.mio-background-send-wave/);
    assert.match(cssSource, /\.mio-background-emotion-particles/);
    assert.match(cssSource, /\.mio-background-emotion-particle/);
    assert.match(cssSource, /\.mio-background-foreground-particles/);
    assert.match(cssSource, /\.mio-background-foreground-particle/);
    assert.match(cssSource, /\.mio-background-foreground-particles::before/);
    assert.match(cssSource, /\.mio-background-stage-trails/);
    assert.match(cssSource, /\.mio-background-stage-trail/);
    assert.match(cssSource, /\.mio-stage-click-ripples/);
    assert.match(cssSource, /\.mio-stage-click-ripple/);
    assert.match(cssSource, /@keyframes mio-stage-click-ripple/);
    assert.match(cssSource, /\.mio-background\[data-time-tone="dawn"\]/);
    assert.match(cssSource, /\.mio-background\[data-time-tone="deep-night"\]/);
    assert.doesNotMatch(cssSource, /\.mio-hud \.mio-topbar::before/);
    assert.doesNotMatch(cssSource, /\.mio-hud \.mio-sidebar::before/);
    assert.doesNotMatch(cssSource, /\.mio-hud \.mio-right-rail::before/);
    assert.match(cssSource, /\.select,\s*[\s\S]*?\.mio-model-select select,\s*[\s\S]*?\.mio-advanced-field select,\s*[\s\S]*?\.mio-advanced-filter select,\s*[\s\S]*?\.mio-chatbox-filter\s*\{[\s\S]*?appearance: none;[\s\S]*?-webkit-appearance: none;[\s\S]*?background-image:/);
    assert.match(cssSource, /\.select,\s*[\s\S]*?\.mio-model-select select,\s*[\s\S]*?\.mio-advanced-field select,\s*[\s\S]*?\.mio-advanced-filter select,\s*[\s\S]*?\.mio-chatbox-filter\s*\{[\s\S]*?background-repeat: no-repeat;[\s\S]*?background-position: right 12px center;[\s\S]*?background-size: 12px 12px;/);
    assert.match(cssSource, /\.mio-advanced-json-preview/);
    assert.match(cssSource, /\.mio-dialogue-copy\s*\{/);
    assert.match(cssSource, /\.mio-dialogue-copy::before,\s*[\s\S]*?\.mio-dialogue-copy::after\s*\{/);
    assert.match(cssSource, /\.mio-chatbox-actions/);
    assert.match(cssSource, /\.mio-chatbox-controls/);
    assert.match(cssSource, /\.mio-chatbox-session-item\.is-active/);
    assert.match(cssSource, /\.mio-chatbox-toolbar\s*\{[\s\S]*?grid-template-columns: minmax\(112px, 1fr\) minmax\(82px, auto\);/);
    assert.match(cssSource, /\.mio-chatbox-action\s*\{[^}]*?cursor: pointer;[^}]*?\}/);
    assert.match(cssSource, /\.mio-chatbox-search::-webkit-search-cancel-button\s*\{[\s\S]*?-webkit-appearance: none;[\s\S]*?appearance: none;/);
    assert.match(cssSource, /\.mio-right-rail\s*\{[\s\S]*?container-type: inline-size;/);
    assert.match(cssSource, /@container \(max-width: 350px\)\s*\{[\s\S]*?\.mio-chatbox-toolbar\s*\{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?\}/);
    assert.match(cssSource, /@container \(max-width: 235px\)\s*\{[\s\S]*?\.mio-chatbox-actions,\s*[\s\S]*?\.mio-chatbox-toolbar\s*\{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?\}/);
    assert.match(cssSource, /@container \(max-width: 235px\)\s*\{[\s\S]*?\.mio-chatbox-toolbar\s*\{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?\}/);
    assert.match(cssSource, /\.mio-tts-switch\s*\{[\s\S]*?background: linear-gradient\(180deg, rgba\(37, 62, 96, 0\.82\), rgba\(13, 30, 57, 0\.92\)\);/);
    assert.match(cssSource, /\.mio-tts-switch\.is-on\s*\{[\s\S]*?background: linear-gradient\(180deg, #58adff, #3f81fb\);/);
    assert.match(cssSource, /\.mio-background\[data-emotion="sad"\]/);
    assert.match(cssSource, /\.mio-background\[data-emotion="thinking"\]/);
    assert.match(cssSource, /\.mio-background\[data-emotion="caring"\]/);
    assert.match(cssSource, /--meteor-travel/);
    assert.match(cssSource, /--meteor-head-size/);
    assert.match(cssSource, /\.mio-background-particle::before/);
    assert.match(cssSource, /--particle-drift-x/);
    assert.match(cssSource, /--particle-drift-y/);
    assert.match(cssSource, /#63CFFF/i);
    assert.match(cssSource, /@keyframes mio-meteor-fall/);
    assert.match(cssSource, /@keyframes mio-meteor-head-bloom/);
    assert.match(cssSource, /@keyframes mio-reflection-shimmer/);
    assert.match(cssSource, /@keyframes mio-voice-ripple/);
    assert.match(cssSource, /@keyframes mio-moonlight-roam/);
    assert.match(cssSource, /@keyframes mio-caustics-flow/);
    assert.match(cssSource, /@keyframes mio-nebula-flow/);
    assert.match(cssSource, /@keyframes mio-cloud-drift/);
    assert.match(cssSource, /@keyframes mio-light-pillar-bloom/);
    assert.match(cssSource, /@keyframes mio-ring-scan-sweep/);
    assert.match(cssSource, /@keyframes mio-send-wave-burst/);
    assert.match(cssSource, /@keyframes mio-emotion-spark/);
    assert.doesNotMatch(cssSource, /@keyframes mio-panel-glint/);
    assert.match(cssSource, /@keyframes mio-orbiter-lap/);
    assert.match(cssSource, /@keyframes mio-foreground-particle-float/);
    assert.match(cssSource, /@keyframes mio-stage-trail-glide/);
    assert.match(cssSource, /@keyframes mio-star-drift/);
    assert.match(cssSource, /@keyframes mio-star-twinkle/);
    assert.match(cssSource, /@keyframes mio-particle-float/);
    assert.match(cssSource, /\.mio-layout\s*\{/);
    assert.match(cssSource, /display: flex;/);
    assert.match(cssSource, /padding: var\(--mio-layout-padding-top\) var\(--mio-layout-padding-x\) 0;/);
    assert.match(cssSource, /margin-bottom: var\(--mio-side-panels-bottom-gap\);/);
    assert.match(cssSource, /\.mio-topbar\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?gap: clamp\(8px, 2vw, 20px\);/);
    assert.match(cssSource, /\.mio-system-state\s*\{[\s\S]*?display: none;[\s\S]*?\}/);
    assert.match(cssSource, /\.mio-brand::before\s*\{[\s\S]*?width: 34px;[\s\S]*?height: 34px;[\s\S]*?flex: 0 0 34px;/);
    assert.match(cssSource, /@media \(max-width: 860px\)\s*\{[\s\S]*?\.mio-topbar\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) auto;[\s\S]*?gap: 8px;[\s\S]*?\}/);
    assert.doesNotMatch(cssSource.match(/\.mio-system-state\s*\{[^}]*?\}/)?.[0] || "", /grid-column: 1 \/ -1;/);
    assert.doesNotMatch(runtimeSource, /mio-petals-atlas/);
    assert.doesNotMatch(runtimeSource, /PETAL_/);
    assert.doesNotMatch(runtimeSource, /anime_stage_petal_flow/);
    assert.doesNotMatch(runtimeSource, /background_petals/);
    assert.doesNotMatch(runtimeSource, /midground_petals/);
    assert.doesNotMatch(runtimeSource, /foreground_petals/);
    assert.doesNotMatch(runtimeSource, /setupPetalSystem/);
    assert.doesNotMatch(runtimeSource, /resetPetalParticle/);
    assert.doesNotMatch(runtimeSource, /updatePetalSystem/);
    assert.doesNotMatch(runtimeSource, /disposePetalSystem/);
    assert.doesNotMatch(runtimeSource, /getPetalGuideTargets/);
    assert.doesNotMatch(runtimeSource, /petalGuide/);
    assert.match(runtimeSource, /hitTestModelAtClientPoint\(clientX, clientY\)/);
    assert.match(
      runtimeSource,
      /"mio-reference":\s*\{[\s\S]*?camera:\s*\{[\s\S]*?fov:\s*32[\s\S]*?position:\s*\[-1\.346829,\s*2\.907039,\s*31\.361977\][\s\S]*?target:\s*\[-1\.346829,\s*0\.961375,\s*0\.436541\][\s\S]*?locked:\s*false/,
    );
  }

  {
    const defaultInteraction = createDefaultStageInteraction();
    const previewInteraction = {
      ...defaultInteraction,
      mode: "vmd",
      vmdUrl: "/assets/vmd/file/preview",
      vmdLoopEmotionByUrl: { "/assets/vmd/file/preview": "happy" },
    };

    assert.deepEqual(resetStageInteraction({ defaultInteraction }), {
      mode: "default_idle",
      source: "default",
      interaction: defaultInteraction,
      activeVmdAssetId: "",
      pendingAutoResume: false,
    });
    assert.equal(
      startManualPreview({
        interaction: previewInteraction,
        activeVmdAssetId: "preview-id",
        canAutoResume: true,
      }).mode,
      "manual_preview",
    );
    assert.equal(startChatInteraction({ interaction: previewInteraction }).mode, "chat_vmd_action");
    assert.equal(
      startStageClickInteraction({
        interaction: previewInteraction,
        activeVmdAssetId: "preview-id",
        canAutoResume: true,
      }).mode,
      "stage_click_vmd_action",
    );
    assert.equal(
      completeStageInteraction({
        autoplayResumeInteraction: previewInteraction,
        defaultInteraction,
        autoplayAssetId: "preview-id",
      }).mode,
      "autoplay_loop",
    );
  }

  {
    assert.deepEqual(
      createStageClickRipple({
        id: "basic",
        clientX: 120,
        clientY: 240,
        rect: { left: 20, top: 40, width: 200, height: 400 },
      }),
      { id: "basic", x: 100, y: 200, xPercent: 50, yPercent: 50 },
    );
    assert.equal(
      shouldTriggerStageCharacterClick({
        downClientX: 100,
        downClientY: 100,
        upClientX: 103,
        upClientY: 103,
        downTimeMs: 10,
        upTimeMs: 180,
      }),
      true,
    );
    assert.equal(
      shouldTriggerStageCharacterClick({
        downClientX: 100,
        downClientY: 100,
        upClientX: 100,
        upClientY: 100,
        downTimeMs: 10,
        upTimeMs: 700,
      }),
      false,
    );
    const clickAction = resolveStageCharacterClickInteraction({
      assets: [
        { asset_id: "a", slot: "happy", url: "/assets/vmd/file/a" },
        { asset_id: "b", slot: "caring", url: "/assets/vmd/file/b" },
      ],
      randomValue: 0.99,
    });
    assert.equal(clickAction.activeVmdAssetId, "b");
    assert.equal(clickAction.interaction.mode, "vmd");
    assert.equal(clickAction.interaction.vmdUrl, "/assets/vmd/file/b");
  }

  {
    const resolved = resolveActionConfig({
      slot: "happy",
      userMappings: {
        happy: { kind: "procedural", value: "cheer" },
      },
      defaultMappings: {
        happy: { kind: "procedural", value: "wave" },
      },
    });
    assert.equal(resolved.kind, "procedural");
    assert.equal(resolved.value, "cheer");
  }

  {
    const resolved = resolvePlaybackPlan({
      slot: "happy",
      action: "wave",
      userMappings: {
        happy: { kind: "vmd", value: "missing-asset-id" },
      },
      defaultMappings: {},
      assetIndex: {},
    });
    assert.equal(resolved.mode, "procedural");
    assert.equal(resolved.action, "wave");
  }

  {
    const resolved = resolvePlaybackPlan({
      slot: "happy",
      action: "wave",
      motionPlan: {
        sequence: [
          { template: "greet_wave", duration_ms: 1200, intensity: 0.8 },
          { template: "listen_lean", duration_ms: 1800, intensity: 0.4 },
        ],
      },
      userMappings: {},
      defaultMappings: {},
      assetIndex: {},
    });
    assert.equal(resolved.mode, "procedural");
    assert.deepEqual(resolved.sequence, [
      { action: "wave", durationMs: 1200, intensity: 0.8, template: "greet_wave" },
      { action: "lean_in", durationMs: 1800, intensity: 0.4, template: "listen_lean" },
    ]);
  }

  {
    assert.equal(DEFAULT_VMD_PLAYBACK_RATE, 1);
    assert.equal(BUILT_IN_VMD_PLAYBACK_RATE, 1.8);
    assert.ok(BUILT_IN_VMD_PLAYBACK_RATE > DEFAULT_VMD_PLAYBACK_RATE);
    assert.equal(resolveVmdPlaybackRate({ filename: "idle_animations_pack/pose.vmd" }), 2.5);
    assert.equal(resolveVmdPlaybackRate({ filename: "idle_animations_pack/pose.vmd" }, 0.8), 2);
    assert.equal(resolveVmdPlaybackRate({ url: "/assets/mmd/vmd/idle_animations_pack/sample.vmd" }), 2.5);
    assert.equal(
      resolveVmdPlaybackRate({
        filename: "Smelling Something in the Air.vmd",
        source_relative_path: "Idle Animations Pack - Copy/Air Scent Idle Animation/Smelling Something in the Air.vmd",
      }),
      2.5,
    );
    assert.equal(resolveVmdPlaybackRate({ filename: "wave.vmd" }), DEFAULT_VMD_PLAYBACK_RATE);
    assert.equal(resolveVmdPlaybackRate({ filename: "wave.vmd" }, 1.5), 1.5);
    assert.deepEqual(
      createDefaultFavoriteLoopInteraction([
        {
          asset_id: "asset-standby",
          slot: "neutral",
          filename: "进场待机.vmd",
          display_name: "进场待机.vmd",
          url: "/assets/vmd/file/asset-standby",
        },
        {
          asset_id: "asset-2",
          slot: "sad",
          filename: "lead.vmd",
          display_name: "lead.vmd",
          url: "/assets/vmd/file/asset-2",
        },
        {
          asset_id: "asset-1",
          slot: "happy",
          filename: "follow.vmd",
          display_name: "follow.vmd",
          url: "/assets/vmd/file/asset-1",
        },
      ], { randomValue: 0 }),
      {
        emotion: "sad",
        action: "idle",
        mode: "vmd",
        vmdUrl: "/assets/vmd/file/asset-2",
        vmdLoopUrls: ["/assets/vmd/file/asset-2", "/assets/vmd/file/asset-1"],
        vmdLoopEmotionByUrl: {
          "/assets/vmd/file/asset-2": "sad",
          "/assets/vmd/file/asset-1": "happy",
        },
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
        sequence: [],
      },
    );
    assert.deepEqual(
      buildAutoFavoriteInteraction(
        [
        {
          asset_id: "asset-standby",
          slot: "neutral",
          filename: "杩涘満寰呮満.vmd",
          display_name: "杩涘満寰呮満.vmd",
          url: "/assets/vmd/file/asset-standby",
        },
        {
          asset_id: "asset-2",
          slot: "sad",
          filename: "lead.vmd",
          display_name: "lead.vmd",
          url: "/assets/vmd/file/asset-2",
        },
        {
          asset_id: "asset-1",
          slot: "happy",
          filename: "follow.vmd",
          display_name: "follow.vmd",
          url: "/assets/vmd/file/asset-1",
        },
        ],
        { randomValue: 0 },
      ),
      {
        emotion: "sad",
        action: "idle",
        mode: "vmd",
        vmdUrl: "/assets/vmd/file/asset-2",
        vmdLoopUrls: ["/assets/vmd/file/asset-2", "/assets/vmd/file/asset-1"],
        vmdLoopEmotionByUrl: {
          "/assets/vmd/file/asset-2": "sad",
          "/assets/vmd/file/asset-1": "happy",
        },
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
        sequence: [],
      },
    );
    assert.deepEqual(
      buildAutoplayResumeInteraction([
        {
          asset_id: "asset-standby",
          slot: "neutral",
          filename: "杩涘満寰呮満.vmd",
          display_name: "杩涘満寰呮満.vmd",
          url: "/assets/vmd/file/asset-standby",
        },
        {
          asset_id: "asset-2",
          slot: "sad",
          filename: "lead.vmd",
          display_name: "lead.vmd",
          url: "/assets/vmd/file/asset-2",
        },
        {
          asset_id: "asset-1",
          slot: "happy",
          filename: "follow.vmd",
          display_name: "follow.vmd",
          url: "/assets/vmd/file/asset-1",
        },
      ], { randomValue: 0 }),
      {
        emotion: "sad",
        action: "idle",
        mode: "vmd",
        vmdUrl: "/assets/vmd/file/asset-2",
        vmdLoopUrls: ["/assets/vmd/file/asset-2", "/assets/vmd/file/asset-1"],
        vmdLoopEmotionByUrl: {
          "/assets/vmd/file/asset-2": "sad",
          "/assets/vmd/file/asset-1": "happy",
        },
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
        sequence: [],
      },
    );
    assert.equal(
      createDefaultFavoriteLoopInteraction([
        {
          asset_id: "asset-standby-only",
          slot: "neutral",
          filename: "杩涘満寰呮満.vmd",
          display_name: "杩涘満寰呮満.vmd",
          url: "/assets/vmd/file/asset-standby-only",
        },
      ]),
      null,
    );
    assert.deepEqual(
      buildAutoFavoriteInteraction(
        [
          {
            asset_id: "asset-first",
            slot: "neutral",
            filename: "回答-介绍.vmd",
            display_name: "回答-介绍.vmd",
            source_relative_path: "usage/vmd/Eula[动作]/回答-介绍.vmd",
            url: "/assets/vmd/file/asset-first",
          },
          {
            asset_id: "asset-greet",
            slot: "happy",
            filename: "打招呼1.vmd",
            display_name: "打招呼1.vmd",
            source_relative_path: "usage/vmd/Eula[动作]/打招呼1.vmd",
            url: "/assets/vmd/file/asset-greet",
          },
          {
            asset_id: "asset-shy",
            slot: "happy",
            filename: "腼腆打招呼.vmd",
            display_name: "腼腆打招呼.vmd",
            source_relative_path: "usage/vmd/Eula[动作]/腼腆打招呼.vmd",
            url: "/assets/vmd/file/asset-shy",
          },
          {
            asset_id: "asset-bow",
            slot: "happy",
            filename: "行礼1.vmd",
            display_name: "行礼1.vmd",
            source_relative_path: "usage/vmd/Eula[动作]/行礼1.vmd",
            url: "/assets/vmd/file/asset-bow",
          },
        ],
        { randomValue: 0.99 },
      ),
      {
        emotion: "happy",
        action: "idle",
        mode: "vmd",
        vmdUrl: "/assets/vmd/file/asset-bow",
        vmdLoopUrls: [
          "/assets/vmd/file/asset-first",
          "/assets/vmd/file/asset-greet",
          "/assets/vmd/file/asset-shy",
          "/assets/vmd/file/asset-bow",
        ],
        vmdLoopEmotionByUrl: {
          "/assets/vmd/file/asset-first": "neutral",
          "/assets/vmd/file/asset-greet": "happy",
          "/assets/vmd/file/asset-shy": "happy",
          "/assets/vmd/file/asset-bow": "happy",
        },
        standbyVmdUrl: "",
        loopMode: "random",
        playbackRate: DEFAULT_VMD_PLAYBACK_RATE,
        sequence: [],
      },
    );
  }

  {
    const files = collectImportableVmdFiles([
      { name: "idle_a.vmd" },
      { name: "README.txt" },
      { name: "pose.VMD" },
      { name: "" },
    ]);
    assert.deepEqual(files.map((file) => file.name), ["idle_a.vmd", "pose.VMD"]);
  }

  {
    const headers = buildTraceHeaders("trace-fixed", "u1");
    assert.equal(headers["x-trace-id"], "trace-fixed");
    assert.equal(headers["x-user-id"], "u1");
  }

  {
    const headers = buildTraceHeaders("", "u2");
    assert.ok(headers["x-trace-id"]);
    assert.equal(headers["x-user-id"], "u2");
  }

  console.log("basic checks passed");
}

run();

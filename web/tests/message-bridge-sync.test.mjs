import assert from "node:assert/strict";

import {
  resolveMessageBridgeRefresh,
  resolveMessageBridgeSessionSync,
  resolveMessageBridgeStatusLoad,
} from "../src/lib/messageBridgeSync.js";

const enabledStatus = {
  enabled: true,
  binding: {
    local_session_id: "bridge-session",
  },
};

assert.deepEqual(
  resolveMessageBridgeSessionSync({
    status: enabledStatus,
    currentSessionId: "local-session",
    busy: false,
  }),
  { action: "open", sessionId: "bridge-session" },
  "enabled Bridge opens the bound local session when another session is active",
);

assert.deepEqual(
  resolveMessageBridgeSessionSync({
    status: enabledStatus,
    currentSessionId: "bridge-session",
    busy: false,
  }),
  { action: "refresh", sessionId: "bridge-session" },
  "enabled Bridge refreshes messages when the bound session is already active",
);

assert.deepEqual(
  resolveMessageBridgeSessionSync({
    status: enabledStatus,
    currentSessionId: "local-session",
    busy: true,
  }),
  { action: "none", sessionId: "" },
  "Bridge sync waits while chat state is busy",
);

assert.deepEqual(
  resolveMessageBridgeSessionSync({
    status: { enabled: false, binding: { local_session_id: "bridge-session" } },
    currentSessionId: "local-session",
    busy: false,
  }),
  { action: "none", sessionId: "" },
  "disabled Bridge does not change the active chat session",
);

assert.deepEqual(
  resolveMessageBridgeSessionSync({
    status: { enabled: true, binding: null },
    currentSessionId: "local-session",
    busy: false,
  }),
  { action: "none", sessionId: "" },
  "Bridge sync waits until a binding exists",
);

const previousSessions = [{ external_session_key: "agent:main:feishu:direct:ou_previous" }];

assert.deepEqual(
  resolveMessageBridgeStatusLoad({
    status: {
      enabled: true,
      binding: {
        local_session_id: "bridge-session",
        external_session_key: "agent:main:feishu:direct:ou_bound",
      },
    },
    sessions: null,
    previousStatus: null,
    previousSessions,
    currentSelectedSessionKey: "",
    sessionsError: new Error("timed out during opening handshake"),
  }),
  {
    status: {
      enabled: true,
      binding: {
        local_session_id: "bridge-session",
        external_session_key: "agent:main:feishu:direct:ou_bound",
      },
    },
    sessions: previousSessions,
    selectedSessionKey: "agent:main:feishu:direct:ou_bound",
    sessionListUnavailable: true,
  },
  "Bridge status stays usable when the remote session list probe fails",
);

const currentMessages = [{ id: "known-message", content: "known" }];
const serverMessages = [
  { id: "known-message", content: "known" },
  { id: "new-bridge-message", content: "new from dashboard" },
];

assert.deepEqual(
  resolveMessageBridgeRefresh({
    currentMessages,
    serverMessages,
    requestLatestOnNewBridgeMessages: true,
  }),
  {
    changed: true,
    nextMessages: serverMessages,
    newServerMessages: [serverMessages[1]],
    shouldRequestLatest: true,
  },
  "Bridge refresh exposes new server messages and requests latest-scroll for remote updates",
);

assert.equal(
  resolveMessageBridgeRefresh({
    currentMessages: serverMessages,
    serverMessages,
    requestLatestOnNewBridgeMessages: true,
  }).shouldRequestLatest,
  false,
  "Bridge refresh does not request latest-scroll when no new server messages arrive",
);

const pendingTtsMessages = [
  {
    id: "assistant-with-pending-tts",
    role: "assistant",
    content: "voice is still rendering",
    tts: {
      id: "tts-1",
      status: "pending",
      taskId: "task-1",
      remoteAudioUrl: undefined,
      proxyAudioUrl: "/tts/proxy/tts-1",
    },
  },
];
const readyTtsServerMessages = [
  {
    id: "assistant-with-pending-tts",
    role: "assistant",
    content: "voice is still rendering",
    tts: {
      id: "tts-1",
      status: "ready",
      task_id: "task-1",
      remote_audio_url: "http://tts.local/audio.wav",
      proxy_audio_url: "/tts/proxy/tts-1",
      updated_at: "2026-05-16T13:02:14.221555+00:00",
    },
  },
];

assert.deepEqual(
  resolveMessageBridgeRefresh({
    currentMessages: pendingTtsMessages,
    serverMessages: readyTtsServerMessages,
    requestLatestOnNewBridgeMessages: true,
  }),
  {
    changed: true,
    nextMessages: readyTtsServerMessages,
    newServerMessages: [],
    shouldRequestLatest: false,
  },
  "Bridge refresh updates existing messages when their TTS reference becomes ready",
);

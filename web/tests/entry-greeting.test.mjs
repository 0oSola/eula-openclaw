import assert from "node:assert/strict";

import { resolveEntryGreetingMessage, shouldAutoPlayEntryGreeting } from "../src/lib/entryGreeting.js";

const latestAssistant = {
  id: "assistant-1",
  role: "assistant",
  content: "ordinary reply",
  createdAt: "2026-05-17T05:00:00Z",
};

const latestGreeting = {
  id: "greeting-1",
  role: "assistant",
  content: "noon greeting",
  createdAt: "2026-05-17T04:01:40Z",
  tts: {
    status: "ready",
    mode: "server",
    proxyAudioUrl: "/tts/proxy/greeting-tts",
  },
};

assert.equal(
  resolveEntryGreetingMessage({ latestGreetingMessage: latestGreeting, latestAssistantMessage: latestAssistant }),
  latestGreeting,
  "entry bubble prefers the latest DB greeting over the active chat assistant copy",
);

assert.equal(
  resolveEntryGreetingMessage({ latestGreetingMessage: null, latestAssistantMessage: latestAssistant }),
  latestAssistant,
  "entry bubble falls back to the active chat assistant copy when no greeting exists",
);

assert.equal(
  shouldAutoPlayEntryGreeting({ message: latestGreeting, playedGreetingIds: new Set() }),
  true,
  "ready greeting TTS should auto-play when it has not played in this page session",
);

assert.equal(
  shouldAutoPlayEntryGreeting({ message: latestGreeting, playedGreetingIds: new Set(["greeting-1"]) }),
  false,
  "same greeting should not auto-play twice in one page session",
);

import test from "node:test";
import assert from "node:assert/strict";

import { requestServerTtsAudio } from "../src/lib/ttsClient.js";

test("requestServerTtsAudio returns an audio blob for configured server TTS", async () => {
  const calls = [];
  const result = await requestServerTtsAudio({
    userId: "u1",
    text: "你好",
    sessionId: "s1",
    makeUrl: (path) => `http://api.test${path}`,
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(new Blob(["fake-mp3"], { type: "audio/mpeg" }), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      });
    },
  });

  assert.equal(result.configured, true);
  assert.equal(result.mediaType, "audio/mpeg");
  assert.equal(await result.audio.text(), "fake-mp3");
  assert.equal(calls[0].url, "http://api.test/tts/speak");
  assert.equal(calls[0].init.method, "POST");
  assert.equal(calls[0].init.headers["x-user-id"], "u1");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    text: "你好",
    voice: "default",
    session_id: "s1",
  });
});

test("requestServerTtsAudio keeps browser fallback behavior when server TTS is disabled", async () => {
  const result = await requestServerTtsAudio({
    userId: "u1",
    text: "hello",
    makeUrl: (path) => `http://api.test${path}`,
    fetchImpl: async () =>
      new Response(JSON.stringify({ configured: false, message: "Server TTS is not configured." }), {
        status: 501,
        headers: { "content-type": "application/json" },
      }),
  });

  assert.deepEqual(result, {
    configured: false,
    message: "Server TTS is not configured.",
  });
});

test("requestServerTtsAudio throws response details for non-fallback errors", async () => {
  await assert.rejects(
    () =>
      requestServerTtsAudio({
        userId: "u1",
        text: "hello",
        makeUrl: (path) => `http://api.test${path}`,
        fetchImpl: async () =>
          new Response(JSON.stringify({ detail: "OpenClaw speech failed" }), {
            status: 502,
            headers: { "content-type": "application/json" },
          }),
      }),
    /OpenClaw speech failed/,
  );
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  authenticatedBackendAudioUrl,
  DEFAULT_TTS_MODE,
  playRemoteTtsAudio,
  playServerTtsAudio,
} from "../src/lib/ttsPlayback.js";

test("server TTS is the default playback mode", () => {
  assert.equal(DEFAULT_TTS_MODE, "server");
});

test("playServerTtsAudio plays the OpenClaw audio blob", async () => {
  const events = {};
  const calls = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      calls.push(["new Audio", src]);
    }

    set onplay(handler) {
      events.play = handler;
    }

    set onended(handler) {
      events.ended = handler;
    }

    set onerror(handler) {
      events.error = handler;
    }

    play() {
      calls.push(["play", this.src]);
      events.play?.();
      return Promise.resolve();
    }
  }

  const audioBlob = new Blob(["openclaw-mp3"], { type: "audio/mpeg" });
  const speakingStates = [];
  const controller = await playServerTtsAudio(audioBlob, {
    AudioCtor: FakeAudio,
    createObjectURL: (blob) => {
      assert.equal(blob, audioBlob);
      calls.push(["createObjectURL", blob.type]);
      return "blob:openclaw-audio";
    },
    revokeObjectURL: (url) => calls.push(["revokeObjectURL", url]),
    setSpeaking: (value) => speakingStates.push(value),
  });

  assert.deepEqual(calls.slice(0, 3), [
    ["createObjectURL", "audio/mpeg"],
    ["new Audio", "blob:openclaw-audio"],
    ["play", "blob:openclaw-audio"],
  ]);
  assert.deepEqual(speakingStates, [true]);

  events.ended();

  assert.deepEqual(calls.at(-1), ["revokeObjectURL", "blob:openclaw-audio"]);
  assert.deepEqual(speakingStates, [true, false]);
  assert.equal(controller.objectUrl, "blob:openclaw-audio");
});

test("playServerTtsAudio cleans up and rethrows when browser audio playback is rejected", async () => {
  const events = {};
  const calls = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      calls.push(["new Audio", src]);
    }

    set onplay(handler) {
      events.play = handler;
    }

    set onended(handler) {
      events.ended = handler;
    }

    set onerror(handler) {
      events.error = handler;
    }

    play() {
      calls.push(["play", this.src]);
      return Promise.reject(new Error("NotAllowedError"));
    }
  }

  const speakingStates = [];
  await assert.rejects(
    () =>
      playServerTtsAudio(new Blob(["openclaw-mp3"], { type: "audio/mpeg" }), {
        AudioCtor: FakeAudio,
        createObjectURL: () => "blob:openclaw-audio",
        revokeObjectURL: (url) => calls.push(["revokeObjectURL", url]),
        setSpeaking: (value) => speakingStates.push(value),
      }),
    /NotAllowedError/,
  );

  assert.deepEqual(calls.at(-1), ["revokeObjectURL", "blob:openclaw-audio"]);
  assert.deepEqual(speakingStates, [false]);
});

test("authenticatedBackendAudioUrl routes backend proxy audio with query user id", () => {
  assert.equal(
    authenticatedBackendAudioUrl("/tts/proxy/tts-1", "admin 1"),
    "/api/backend/tts/proxy/tts-1?user_id=admin+1",
  );
  assert.equal(
    authenticatedBackendAudioUrl("/tts/proxy/tts-1?download=1", "admin-1"),
    "/api/backend/tts/proxy/tts-1?download=1&user_id=admin-1",
  );
});

test("playRemoteTtsAudio prefers backend proxy and falls back to remote URL when playback is rejected", async () => {
  const calls = [];
  class FakeAudio {
    constructor(src) {
      this.src = src;
      calls.push(["new Audio", src]);
    }

    set onplay(handler) {
      this.playHandler = handler;
    }

    set onended(handler) {
      this.endHandler = handler;
    }

    set onerror(handler) {
      this.errorHandler = handler;
    }

    play() {
      calls.push(["play", this.src]);
      if (this.src.includes("/api/backend/")) {
        return Promise.reject(new Error("proxy rejected"));
      }
      this.playHandler?.();
      return Promise.resolve();
    }
  }

  const speakingStates = [];
  const controller = await playRemoteTtsAudio({
    remoteAudioUrl: "http://tts.local/audio.wav",
    proxyAudioUrl: "/tts/proxy/tts-1",
    userId: "admin-1",
    AudioCtor: FakeAudio,
    setSpeaking: (value) => speakingStates.push(value),
  });

  assert.deepEqual(calls, [
    ["new Audio", "/api/backend/tts/proxy/tts-1?user_id=admin-1"],
    ["play", "/api/backend/tts/proxy/tts-1?user_id=admin-1"],
    ["play", "http://tts.local/audio.wav"],
  ]);
  assert.deepEqual(speakingStates, [true]);
  assert.equal(controller.audio.src, "http://tts.local/audio.wav");
});

test("playRemoteTtsAudio exposes the audio element before playback starts", async () => {
  const calls = [];
  let exposedAudio = null;
  let exposedCleanup = null;

  class FakeAudio {
    constructor(src) {
      this.src = src;
      calls.push(["new Audio", src]);
    }

    set onplay(handler) {
      this.playHandler = handler;
    }

    set onended(handler) {
      this.endHandler = handler;
    }

    set onerror(handler) {
      this.errorHandler = handler;
    }

    play() {
      calls.push(["play", this.src, exposedAudio === this]);
      this.playHandler?.();
      return Promise.resolve();
    }
  }

  const controller = await playRemoteTtsAudio({
    remoteAudioUrl: "http://tts.local/audio.ogg",
    AudioCtor: FakeAudio,
    onAudioCreated: ({ audio, cleanup }) => {
      calls.push(["audio created", audio.src]);
      exposedAudio = audio;
      exposedCleanup = cleanup;
    },
  });

  assert.deepEqual(calls, [
    ["new Audio", "http://tts.local/audio.ogg"],
    ["audio created", "http://tts.local/audio.ogg"],
    ["play", "http://tts.local/audio.ogg", true],
  ]);
  assert.equal(controller.audio, exposedAudio);
  assert.equal(typeof exposedCleanup, "function");
});

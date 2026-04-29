import test from "node:test";
import assert from "node:assert/strict";

import { DEFAULT_TTS_MODE, playServerTtsAudio } from "../src/lib/ttsPlayback.js";

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

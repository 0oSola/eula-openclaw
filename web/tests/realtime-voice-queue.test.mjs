import test from "node:test";
import assert from "node:assert/strict";

import { AudioQueue, sessionVoiceWebSocketUrl } from "../src/lib/realtimeVoiceQueue.js";

const tick = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

test("sessionVoiceWebSocketUrl encodes session and user for backend websocket", () => {
  assert.equal(
    sessionVoiceWebSocketUrl("s 1", "admin-1", { baseUrl: "http://api.test:8000" }),
    "ws://api.test:8000/ws/sessions/s%201/voice?user_id=admin-1",
  );
  assert.equal(
    sessionVoiceWebSocketUrl("secure/session", "admin 1", { baseUrl: "https://api.test" }),
    "wss://api.test/ws/sessions/secure%2Fsession/voice?user_id=admin+1",
  );
});

test("AudioQueue plays by first-seen job order then sequence without overlap", async () => {
  const plays = [];
  const instances = [];

  class FakeAudio {
    constructor(src) {
      this.src = src;
      instances.push(this);
    }

    play() {
      plays.push(this.src);
      this.onplay?.();
      return Promise.resolve();
    }

    finish() {
      this.onended?.();
    }
  }

  const queue = new AudioQueue({ AudioCtor: FakeAudio });
  queue.enqueue({ jobId: "job-2", sequence: 1, url: "/job-2-1.wav" });
  queue.enqueue({ jobId: "job-1", sequence: 2, url: "/job-1-2.wav" });
  queue.enqueue({ jobId: "job-1", sequence: 1, url: "/job-1-1.wav" });

  await tick();
  assert.deepEqual(plays, ["/job-2-1.wav"]);

  instances[0].finish();
  await tick();
  assert.deepEqual(plays, ["/job-2-1.wav", "/job-1-1.wav"]);

  instances[1].finish();
  await tick();
  assert.deepEqual(plays, ["/job-2-1.wav", "/job-1-1.wav", "/job-1-2.wav"]);

  instances[2].finish();
  await queue.whenIdle();
  assert.equal(queue.hasPlayedChunk("job-1"), true);
  assert.equal(queue.hasPlayedChunk("missing"), false);
});

test("AudioQueue drives speech levels from each realtime audio chunk envelope", async () => {
  const levels = [];
  const instances = [];
  let rafCallback = null;

  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.paused = false;
      this.ended = false;
      instances.push(this);
    }

    play() {
      this.onplay?.();
      return Promise.resolve();
    }

    finish() {
      this.ended = true;
      this.onended?.();
    }
  }

  const queue = new AudioQueue({
    AudioCtor: FakeAudio,
    setSpeechLevel: (level) => levels.push(Number(level.toFixed(2))),
    loadSpeechEnvelope: async () => ({ peaks: [0.2, 0.7], duration: 2 }),
    requestAnimationFrame: (callback) => {
      rafCallback = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  });

  queue.enqueue({ jobId: "job-1", sequence: 1, url: "/chunk-1.wav" });
  await tick();
  await Promise.resolve();
  assert.deepEqual(levels, [0.2]);

  instances[0].currentTime = 1.4;
  rafCallback?.();
  assert.deepEqual(levels, [0.2, 0.7]);

  instances[0].finish();
  await queue.whenIdle();
  assert.equal(levels.at(-1), 0);
});

test("AudioQueue drives Mandarin speech visemes from each realtime chunk text", async () => {
  const visemes = [];
  const instances = [];
  let rafCallback = null;

  class FakeAudio {
    constructor(src) {
      this.src = src;
      this.currentTime = 0;
      this.duration = 1;
      this.paused = false;
      this.ended = false;
      instances.push(this);
    }

    play() {
      this.onplay?.();
      return Promise.resolve();
    }

    finish() {
      this.ended = true;
      this.onended?.();
    }
  }

  const queue = new AudioQueue({
    AudioCtor: FakeAudio,
    setSpeechViseme: (frame) => visemes.push(frame?.viseme || "none"),
    requestAnimationFrame: (callback) => {
      rafCallback = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  });

  queue.enqueue({ jobId: "job-1", sequence: 1, url: "/chunk-1.wav", text: "妈妈", duration: 1 });
  await tick();
  assert.equal(visemes.at(-1), "M");

  instances[0].currentTime = 0.3;
  rafCallback?.();
  assert.equal(visemes.at(-1), "A");

  instances[0].finish();
  await queue.whenIdle();
  assert.equal(visemes.at(-1), "none");
});

test("AudioQueue classifies playback errors before and after partial playback", async () => {
  const errors = [];
  const instances = [];

  class FakeAudio {
    constructor(src) {
      this.src = src;
      instances.push(this);
    }

    play() {
      return Promise.resolve();
    }

    fail() {
      this.onerror?.(new Error(`failed ${this.src}`));
    }
  }

  const queue = new AudioQueue({ AudioCtor: FakeAudio, onError: (event) => errors.push(event) });
  queue.enqueue({ jobId: "job-before", sequence: 1, url: "/before.wav" });

  await tick();
  instances[0].fail();
  await queue.whenIdle();

  assert.equal(errors[0].fallback, "auto_before_playback");
  assert.equal(queue.hasPlayedChunk("job-before"), false);

  queue.enqueue({ jobId: "job-after", sequence: 1, url: "/after.wav" });
  await tick();
  instances[1].onplay?.();
  instances[1].fail();
  await queue.whenIdle();

  assert.equal(errors[1].fallback, "manual_after_partial_playback");
  assert.equal(queue.hasPlayedChunk("job-after"), true);
});

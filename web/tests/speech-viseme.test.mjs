import test from "node:test";
import assert from "node:assert/strict";

import {
  buildSpeechVisemeTimeline,
  createSpeechVisemeSync,
  sampleSpeechViseme,
} from "../src/lib/speechViseme.js";

test("Chinese speech visemes map Mandarin finals to MMD mouth shapes", () => {
  const timeline = buildSpeechVisemeTimeline("你好，早上好", { durationSeconds: 1.6 });

  assert.deepEqual(
    timeline.map((frame) => frame.viseme),
    ["I", "A", "O", "sil", "A", "O", "A", "A", "O", "sil"],
  );
  assert.equal(timeline[0].time, 0);
  assert.equal(timeline.at(-1).time, 1.6);
  assert.ok(timeline.every((frame, index) => index === 0 || frame.time >= timeline[index - 1].time));
});

test("Chinese bilabial initials briefly close the mouth before the final", () => {
  const timeline = buildSpeechVisemeTimeline("妈妈", { durationSeconds: 1 });

  assert.deepEqual(
    timeline.map((frame) => frame.viseme),
    ["M", "A", "M", "A", "sil"],
  );
  assert.equal(sampleSpeechViseme(timeline, 0).viseme, "M");
  assert.equal(sampleSpeechViseme(timeline, 0.3).viseme, "A");
  assert.equal(sampleSpeechViseme(timeline, 0.55).viseme, "M");
  assert.equal(sampleSpeechViseme(timeline, 1.2).viseme, "sil");
});

test("speech viseme sync samples text-derived mouth shapes during playback", () => {
  const frames = [];
  let rafCallback = null;
  const audio = {
    currentTime: 0,
    duration: 1,
    paused: false,
    ended: false,
  };
  const sync = createSpeechVisemeSync({
    audio,
    text: "妈妈",
    setViseme: (frame) => frames.push(frame?.viseme || "none"),
    requestAnimationFrame: (callback) => {
      rafCallback = callback;
      return 1;
    },
    cancelAnimationFrame: () => {},
  });

  sync.start();
  assert.equal(frames.at(-1), "M");

  audio.currentTime = 0.3;
  rafCallback?.();
  assert.equal(frames.at(-1), "A");

  sync.stop();
  assert.equal(frames.at(-1), "none");
});

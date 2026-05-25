import assert from "node:assert/strict";

import {
  computePeaks,
  decodeAudioEnvelopeFromArrayBuffer,
  sampleEnvelopeLevel,
  seekTimeFromPointer,
} from "../src/lib/audioWaveform.js";

assert.deepEqual(computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2), [0.5, 1]);
assert.equal(sampleEnvelopeLevel({ peaks: [0.1, 0.6, 0.2], duration: 3 }, 0), 0.1);
assert.equal(sampleEnvelopeLevel({ peaks: [0.1, 0.6, 0.2], duration: 3 }, 1.5), 0.6);
assert.equal(sampleEnvelopeLevel({ peaks: [0.1, 0.6, 0.2], duration: 3 }, 4), 0.2);
assert.equal(seekTimeFromPointer({ clientX: 75, left: 25, width: 100, duration: 120 }), 60);
assert.equal(seekTimeFromPointer({ clientX: -10, left: 0, width: 100, duration: 120 }), 0);
assert.equal(seekTimeFromPointer({ clientX: 200, left: 0, width: 100, duration: 120 }), 120);

class FakeAudioContext {
  async decodeAudioData(_data) {
    return {
      duration: 2,
      getChannelData(channel) {
        assert.equal(channel, 0);
        return new Float32Array([0, 0.25, -0.75, 1]);
      },
    };
  }

  async close() {}
}

const envelope = await decodeAudioEnvelopeFromArrayBuffer(new ArrayBuffer(4), {
  AudioContextCtor: FakeAudioContext,
  bucketCount: 2,
});
assert.deepEqual(envelope, { peaks: [0.25, 1], duration: 2 });

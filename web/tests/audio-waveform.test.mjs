import assert from "node:assert/strict";

import { computePeaks, seekTimeFromPointer } from "../src/lib/audioWaveform.js";

assert.deepEqual(computePeaks(new Float32Array([0, 0.5, -1, 0.25]), 2), [0.5, 1]);
assert.equal(seekTimeFromPointer({ clientX: 75, left: 25, width: 100, duration: 120 }), 60);
assert.equal(seekTimeFromPointer({ clientX: -10, left: 0, width: 100, duration: 120 }), 0);
assert.equal(seekTimeFromPointer({ clientX: 200, left: 0, width: 100, duration: 120 }), 120);

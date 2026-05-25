export function computePeaks(samples, bucketCount) {
  const safeBucketCount = Math.max(1, Math.floor(bucketCount || 1));
  const bucketSize = Math.max(1, Math.ceil(samples.length / safeBucketCount));
  const peaks = [];
  for (let bucket = 0; bucket < safeBucketCount; bucket += 1) {
    let max = 0;
    const start = bucket * bucketSize;
    const end = Math.min(samples.length, start + bucketSize);
    for (let index = start; index < end; index += 1) {
      max = Math.max(max, Math.abs(samples[index] || 0));
    }
    peaks.push(Number(max.toFixed(4)));
  }
  return peaks;
}

function clamp01(value) {
  const next = Number(value);
  if (!Number.isFinite(next)) return 0;
  return Math.min(1, Math.max(0, next));
}

export function sampleEnvelopeLevel(envelope, currentTime) {
  const peaks = Array.isArray(envelope) ? envelope : envelope?.peaks;
  const duration = Number(Array.isArray(envelope) ? 0 : envelope?.duration);
  if (!Array.isArray(peaks) || !peaks.length || !Number.isFinite(duration) || duration <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, Number(currentTime) / duration || 0));
  const index = Math.min(peaks.length - 1, Math.floor(ratio * peaks.length));
  return clamp01(peaks[index]);
}

export async function decodeAudioEnvelopeFromArrayBuffer(
  data,
  {
    AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext,
    bucketCount = 240,
  } = {},
) {
  if (!AudioContextCtor) {
    throw new Error("AudioContext is not available");
  }
  const audioContext = new AudioContextCtor();
  try {
    const sourceData = data?.slice ? data.slice(0) : data;
    const buffer = await audioContext.decodeAudioData(sourceData);
    return {
      peaks: computePeaks(buffer.getChannelData(0), bucketCount),
      duration: Number(buffer.duration) || 0,
    };
  } finally {
    await Promise.resolve(audioContext.close?.()).catch(() => undefined);
  }
}

export async function decodeAudioEnvelopeFromBlob(blob, options = {}) {
  if (!blob?.arrayBuffer) {
    throw new Error("Audio Blob is not available");
  }
  return decodeAudioEnvelopeFromArrayBuffer(await blob.arrayBuffer(), options);
}

export async function fetchAudioEnvelope(
  audioUrl,
  {
    fetchImpl = globalThis.fetch,
    cache = "no-store",
    ...decodeOptions
  } = {},
) {
  if (!fetchImpl) {
    throw new Error("fetch is not available");
  }
  const response = await fetchImpl(audioUrl, { cache });
  if (!response?.ok) {
    throw new Error(`Audio envelope fetch failed: ${response?.status || "unknown"}`);
  }
  return decodeAudioEnvelopeFromArrayBuffer(await response.arrayBuffer(), decodeOptions);
}

export function createAudioEnvelopeLevelSync({
  audio,
  envelopePromise = null,
  setLevel,
  requestAnimationFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelAnimationFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  if (!audio || typeof setLevel !== "function") {
    return {
      setEnvelopePromise() {},
      start() {},
      stop() {},
    };
  }

  let active = false;
  let disposed = false;
  let envelope = null;
  let frameId = null;
  let token = 0;

  const cancelFrame = () => {
    if (frameId !== null) {
      cancelAnimationFrame?.(frameId);
      frameId = null;
    }
  };

  const readLevel = () => {
    if (!active || disposed) return;
    frameId = null;
    if (envelope) {
      setLevel(sampleEnvelopeLevel(envelope, audio.currentTime || 0));
    }
    if (!audio.paused && !audio.ended && requestAnimationFrame) {
      frameId = requestAnimationFrame(readLevel);
    }
  };

  const setEnvelopePromise = (nextEnvelopePromise) => {
    const currentToken = (token += 1);
    envelope = null;
    Promise.resolve(nextEnvelopePromise)
      .then((nextEnvelope) => {
        if (disposed || currentToken !== token) return;
        envelope = nextEnvelope;
        if (active) readLevel();
      })
      .catch(() => undefined);
  };

  const start = () => {
    active = true;
    readLevel();
  };

  const stop = () => {
    active = false;
    disposed = true;
    cancelFrame();
    setLevel(0);
  };

  if (envelopePromise) setEnvelopePromise(envelopePromise);

  return { setEnvelopePromise, start, stop };
}

export function seekTimeFromPointer({ clientX, left, width, duration }) {
  if (!duration || !width) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - left) / width));
  return duration * ratio;
}

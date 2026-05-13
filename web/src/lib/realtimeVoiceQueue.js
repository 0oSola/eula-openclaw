const DEFAULT_API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || "http://127.0.0.1:8000";

function resolveApiUrl(baseUrl, locationLike) {
  const url = new URL(baseUrl || DEFAULT_API_BASE_URL);
  const runtimeHostname = locationLike?.hostname || "";
  if (
    runtimeHostname &&
    runtimeHostname !== "localhost" &&
    runtimeHostname !== "127.0.0.1" &&
    (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  ) {
    url.hostname = runtimeHostname;
  }
  return url;
}

/**
 * @param {string} sessionId
 * @param {string} userId
 * @param {{ baseUrl?: string, location?: Location | { hostname?: string } }} [options]
 * @returns {string}
 */
export function sessionVoiceWebSocketUrl(sessionId, userId, options = {}) {
  const url = resolveApiUrl(options.baseUrl, options.location ?? globalThis.location);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/ws/sessions/${encodeURIComponent(sessionId)}/voice`;
  url.search = new URLSearchParams({ user_id: userId }).toString();
  url.hash = "";
  return url.toString();
}

function normalizeAudioError(error) {
  if (error instanceof Error) return error;
  if (error?.message) return new Error(String(error.message));
  return new Error("Realtime voice playback failed");
}

function noop() {}

export class AudioQueue {
  constructor({
    AudioCtor = globalThis.Audio,
    onError = noop,
    onChunkStart = noop,
    onChunkEnd = noop,
  } = {}) {
    this.AudioCtor = AudioCtor;
    this.onError = onError;
    this.onChunkStart = onChunkStart;
    this.onChunkEnd = onChunkEnd;
    this.entries = [];
    this.jobOrder = new Map();
    this.playedJobs = new Set();
    this.nextJobOrder = 0;
    this.nextEntryIndex = 0;
    this.playing = false;
    this.pumpScheduled = false;
    this.currentAudio = null;
    this.completeCurrent = null;
    this.idleResolvers = [];
  }

  enqueue(chunk) {
    if (!chunk?.jobId) {
      throw new Error("Realtime voice chunk requires jobId");
    }
    if (!chunk.url) {
      throw new Error("Realtime voice chunk requires url");
    }
    if (!this.jobOrder.has(chunk.jobId)) {
      this.jobOrder.set(chunk.jobId, this.nextJobOrder);
      this.nextJobOrder += 1;
    }

    const entry = {
      ...chunk,
      sequence: Number.isFinite(Number(chunk.sequence)) ? Number(chunk.sequence) : 0,
      index: this.nextEntryIndex,
    };
    this.nextEntryIndex += 1;
    this.entries.push(entry);
    this.entries.sort((left, right) => {
      const jobDelta = this.jobOrder.get(left.jobId) - this.jobOrder.get(right.jobId);
      if (jobDelta !== 0) return jobDelta;
      const sequenceDelta = left.sequence - right.sequence;
      if (sequenceDelta !== 0) return sequenceDelta;
      return left.index - right.index;
    });
    this.schedulePump();
    return entry;
  }

  hasPlayedChunk(jobId) {
    return this.playedJobs.has(jobId);
  }

  fallbackForJobError(jobId) {
    return this.hasPlayedChunk(jobId) ? "manual_after_partial_playback" : "auto_before_playback";
  }

  whenIdle() {
    if (!this.playing && this.entries.length === 0 && !this.pumpScheduled) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  stop() {
    this.entries = [];
    this.completeCurrent?.();
    this.completeCurrent = null;
    if (this.currentAudio) {
      this.detachAudioHandlers(this.currentAudio);
      this.currentAudio.pause?.();
    }
    this.currentAudio = null;
    this.playing = false;
    this.notifyIdle();
  }

  clear({ resetHistory = false } = {}) {
    this.stop();
    if (resetHistory) {
      this.jobOrder.clear();
      this.playedJobs.clear();
      this.nextJobOrder = 0;
      this.nextEntryIndex = 0;
    }
  }

  schedulePump() {
    if (this.playing || this.pumpScheduled) return;
    this.pumpScheduled = true;
    Promise.resolve().then(() => {
      this.pumpScheduled = false;
      void this.pump();
    });
  }

  async pump() {
    if (this.playing) return;
    const entry = this.entries.shift();
    if (!entry) {
      this.notifyIdle();
      return;
    }

    this.playing = true;
    await this.playEntry(entry);
    this.playing = false;
    this.currentAudio = null;
    if (this.entries.length > 0) {
      this.schedulePump();
    } else {
      this.notifyIdle();
    }
  }

  async playEntry(entry) {
    if (!this.AudioCtor) {
      this.emitError(entry, new Error("Audio playback is not available"));
      return;
    }

    const audio = new this.AudioCtor(entry.url);
    this.currentAudio = audio;

    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        this.detachAudioHandlers(audio);
        this.completeCurrent = null;
        resolve();
      };
      const fail = (error) => {
        this.emitError(entry, normalizeAudioError(error));
        finish();
      };

      this.completeCurrent = finish;
      audio.onplay = () => {
        this.playedJobs.add(entry.jobId);
        this.onChunkStart(entry);
      };
      audio.onended = () => {
        this.onChunkEnd(entry);
        finish();
      };
      audio.onerror = fail;

      try {
        const playResult = audio.play();
        if (playResult?.catch) {
          playResult.catch(fail);
        }
      } catch (error) {
        fail(error);
      }
    });
  }

  emitError(entry, error) {
    this.onError({
      ...entry,
      error,
      fallback: this.fallbackForJobError(entry.jobId),
    });
  }

  detachAudioHandlers(audio) {
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
  }

  notifyIdle() {
    const resolvers = this.idleResolvers.splice(0);
    for (const resolve of resolvers) {
      resolve();
    }
  }
}

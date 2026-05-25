import {
  createAudioEnvelopeLevelSync,
  decodeAudioEnvelopeFromBlob,
  fetchAudioEnvelope,
} from "./audioWaveform.js";
import { createSpeechVisemeSync } from "./speechViseme.js";

export const DEFAULT_TTS_MODE = "server";

function normalizeAudioPlaybackError(error, fallbackMessage = "Audio playback failed") {
  if (error instanceof Error) return error;
  if (error?.message) return new Error(String(error.message));
  return new Error(fallbackMessage);
}

function noopAudioCreated(_event) {}

export function authenticatedBackendAudioUrl(audioUrl, userId, { backendPrefix = "/api/backend" } = {}) {
  const separator = audioUrl.includes("?") ? "&" : "?";
  const authenticatedPath = `${audioUrl}${separator}${new URLSearchParams({ user_id: userId }).toString()}`;
  if (/^https?:\/\//i.test(authenticatedPath)) return authenticatedPath;
  return `${backendPrefix}${authenticatedPath.startsWith("/") ? authenticatedPath : `/${authenticatedPath}`}`;
}

/**
 * @param {Blob} audioBlob
 * @param {{
 *   AudioCtor?: typeof Audio;
 *   createObjectURL?: (blob: Blob) => string;
 *   revokeObjectURL?: (url: string) => void;
 *   setSpeaking?: (value: boolean) => void;
 *   setSpeechLevel?: (value: number) => void;
 *   setSpeechViseme?: (frame: { viseme: string, weight?: number } | null) => void;
 *   speechText?: string;
 *   speechDurationSeconds?: number;
 *   speechVisemeTimeline?: Array<{ time: number, viseme: string, weight?: number }>;
 *   loadSpeechEnvelope?: (event: { audioBlob: Blob, objectUrl: string, source: string, audio: HTMLAudioElement }) => Promise<{ peaks: number[], duration: number }> | { peaks: number[], duration: number };
 *   requestAnimationFrame?: (callback: FrameRequestCallback) => number;
 *   cancelAnimationFrame?: (handle: number) => void;
 *   onCleanup?: (event: { audio?: HTMLAudioElement, objectUrl?: string }) => void;
 *   onAudioCreated?: (event: { audio: HTMLAudioElement, objectUrl: string, cleanup: () => void }) => void;
 * }} [options]
 */
export async function playServerTtsAudio(
  audioBlob,
  {
    AudioCtor = globalThis.Audio,
    createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
    revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
    setSpeaking = () => {},
    setSpeechLevel = undefined,
    setSpeechViseme = undefined,
    speechText = "",
    speechDurationSeconds = 0,
    speechVisemeTimeline = null,
    loadSpeechEnvelope = ({ audioBlob: sourceBlob }) => decodeAudioEnvelopeFromBlob(sourceBlob),
    requestAnimationFrame = globalThis.requestAnimationFrame?.bind(globalThis),
    cancelAnimationFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
    onCleanup = () => {},
    onAudioCreated = noopAudioCreated,
  } = {},
) {
  if (!AudioCtor || !createObjectURL) {
    throw new Error("Audio playback is not available");
  }

  const objectUrl = createObjectURL(audioBlob);
  const audio = new AudioCtor(objectUrl);
  const speechLevelSync = createAudioEnvelopeLevelSync({
    audio,
    setLevel: setSpeechLevel,
    requestAnimationFrame,
    cancelAnimationFrame,
  });
  const speechVisemeSync = createSpeechVisemeSync({
    audio,
    text: speechText,
    durationSeconds: speechDurationSeconds,
    timeline: speechVisemeTimeline,
    setViseme: setSpeechViseme,
    requestAnimationFrame,
    cancelAnimationFrame,
  });
  if (typeof setSpeechLevel === "function") {
    speechLevelSync.setEnvelopePromise(loadSpeechEnvelope({ audioBlob, objectUrl, source: objectUrl, audio }));
  }
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    speechLevelSync.stop();
    speechVisemeSync.stop();
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
    revokeObjectURL?.(objectUrl);
    setSpeaking(false);
    onCleanup({ audio, objectUrl });
  };

  audio.onplay = () => {
    setSpeaking(true);
    speechLevelSync.start();
    speechVisemeSync.start();
  };
  audio.onended = cleanup;
  audio.onerror = cleanup;
  onAudioCreated({ audio, objectUrl, cleanup });

  try {
    await audio.play();
  } catch (error) {
    cleanup();
    throw error;
  }

  return { audio, objectUrl, cleanup };
}

/**
 * @param {{
 *   remoteAudioUrl?: string;
 *   proxyAudioUrl?: string;
 *   userId?: string;
 *   AudioCtor?: typeof Audio;
 *   backendPrefix?: string;
 *   setSpeaking?: (value: boolean) => void;
 *   setSpeechLevel?: (value: number) => void;
 *   setSpeechViseme?: (frame: { viseme: string, weight?: number } | null) => void;
 *   speechText?: string;
 *   speechDurationSeconds?: number;
 *   speechVisemeTimeline?: Array<{ time: number, viseme: string, weight?: number }>;
 *   onCleanup?: (event?: { audio?: HTMLAudioElement }) => void;
 *   onAudioCreated?: (event: { audio: HTMLAudioElement, cleanup: () => void }) => void;
 *   onFinalError?: (error: Error) => void | Promise<void>;
 * }} [options]
 */
export async function playRemoteTtsAudio({
  remoteAudioUrl = "",
  proxyAudioUrl = "",
  userId = "",
  AudioCtor = globalThis.Audio,
  backendPrefix = "/api/backend",
  setSpeaking = () => {},
  setSpeechLevel = undefined,
  setSpeechViseme = undefined,
  speechText = "",
  speechDurationSeconds = 0,
  speechVisemeTimeline = null,
  loadSpeechEnvelope = ({ source }) => fetchAudioEnvelope(source),
  requestAnimationFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelAnimationFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
  onCleanup = () => {},
  onAudioCreated = noopAudioCreated,
  onFinalError = () => {},
} = {}) {
  if (!AudioCtor) {
    throw new Error("Audio playback is not available");
  }

  const sources = [];
  if (proxyAudioUrl) {
    sources.push(authenticatedBackendAudioUrl(proxyAudioUrl, userId, { backendPrefix }));
  }
  if (remoteAudioUrl) {
    sources.push(remoteAudioUrl);
  }
  const uniqueSources = sources.filter((source, index) => source && sources.indexOf(source) === index);
  if (uniqueSources.length === 0) {
    throw new Error("Remote audio URL is missing");
  }

  const audio = new AudioCtor(uniqueSources[0]);
  const speechLevelSync = createAudioEnvelopeLevelSync({
    audio,
    setLevel: setSpeechLevel,
    requestAnimationFrame,
    cancelAnimationFrame,
  });
  const speechVisemeSync = createSpeechVisemeSync({
    audio,
    text: speechText,
    durationSeconds: speechDurationSeconds,
    timeline: speechVisemeTimeline,
    setViseme: setSpeechViseme,
    requestAnimationFrame,
    cancelAnimationFrame,
  });
  let cleaned = false;
  let sourceIndex = 0;
  let lastError = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    speechLevelSync.stop();
    speechVisemeSync.stop();
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
    setSpeaking(false);
    onCleanup({ audio });
  };

  const playCurrentSource = async () => {
    try {
      if (typeof setSpeechLevel === "function") {
        speechLevelSync.setEnvelopePromise(loadSpeechEnvelope({ source: uniqueSources[sourceIndex], audio }));
      }
      await audio.play();
      return true;
    } catch (error) {
      lastError = normalizeAudioPlaybackError(error);
      return false;
    }
  };

  const playNextSource = async () => {
    while (sourceIndex < uniqueSources.length - 1) {
      sourceIndex += 1;
      audio.src = uniqueSources[sourceIndex];
      if (await playCurrentSource()) return true;
    }
    return false;
  };

  audio.onplay = () => {
    setSpeaking(true);
    speechLevelSync.start();
    speechVisemeSync.start();
  };
  audio.onended = cleanup;
  audio.onerror = () => {
    void (async () => {
      lastError = new Error("Remote audio playback failed");
      if (await playNextSource()) return;
      const finalError = lastError || new Error("Remote audio playback failed");
      cleanup();
      await onFinalError(finalError);
    })();
  };
  onAudioCreated({ audio, cleanup });

  if (!(await playCurrentSource())) {
    if (!(await playNextSource())) {
      const finalError = lastError || new Error("Remote audio playback failed");
      cleanup();
      throw finalError;
    }
  }

  return { audio, cleanup, source: uniqueSources[sourceIndex], sources: uniqueSources };
}

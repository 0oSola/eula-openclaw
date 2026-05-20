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

export async function playServerTtsAudio(
  audioBlob,
  {
    AudioCtor = globalThis.Audio,
    createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
    revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
    setSpeaking = () => {},
    onCleanup = () => {},
    onAudioCreated = noopAudioCreated,
  } = {},
) {
  if (!AudioCtor || !createObjectURL) {
    throw new Error("Audio playback is not available");
  }

  const objectUrl = createObjectURL(audioBlob);
  const audio = new AudioCtor(objectUrl);
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
    revokeObjectURL?.(objectUrl);
    setSpeaking(false);
    onCleanup({ audio, objectUrl });
  };

  audio.onplay = () => setSpeaking(true);
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
  let cleaned = false;
  let sourceIndex = 0;
  let lastError = null;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    audio.onplay = null;
    audio.onended = null;
    audio.onerror = null;
    setSpeaking(false);
    onCleanup({ audio });
  };

  const playCurrentSource = async () => {
    try {
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

  audio.onplay = () => setSpeaking(true);
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

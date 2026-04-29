export const DEFAULT_TTS_MODE = "server";

export async function playServerTtsAudio(
  audioBlob,
  {
    AudioCtor = globalThis.Audio,
    createObjectURL = globalThis.URL?.createObjectURL?.bind(globalThis.URL),
    revokeObjectURL = globalThis.URL?.revokeObjectURL?.bind(globalThis.URL),
    setSpeaking = () => {},
    onCleanup = () => {},
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

  try {
    await audio.play();
  } catch (error) {
    cleanup();
    throw error;
  }

  return { audio, objectUrl, cleanup };
}

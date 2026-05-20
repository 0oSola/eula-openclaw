export function resolveEntryGreetingMessage({ latestGreetingMessage, latestAssistantMessage }) {
  return latestGreetingMessage || latestAssistantMessage || null;
}

export function shouldAutoPlayEntryGreeting({ message, playedGreetingIds }) {
  const messageId = typeof message?.id === "string" ? message.id : "";
  if (!messageId || playedGreetingIds?.has?.(messageId)) return false;
  const tts = message?.tts || null;
  if (tts?.status !== "ready") return false;
  return Boolean(tts.remoteAudioUrl || tts.remote_audio_url || tts.proxyAudioUrl || tts.proxy_audio_url);
}

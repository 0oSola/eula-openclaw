async function readJsonPayload(response) {
  return response.json().catch(() => ({}));
}

export async function requestServerTtsAudio({
  userId,
  text,
  sessionId,
  voice = "default",
  makeUrl,
  fetchImpl = globalThis.fetch,
}) {
  if (!fetchImpl) {
    throw new Error("Fetch is not available for server TTS");
  }

  const body = { text, voice };
  if (sessionId) body.session_id = sessionId;

  const response = await fetchImpl(makeUrl("/tts/speak"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-user-id": userId,
    },
    body: JSON.stringify(body),
  });

  if (response.status === 501) {
    const payload = await readJsonPayload(response);
    return {
      configured: false,
      message: payload?.message || payload?.detail || "Server TTS is not configured.",
    };
  }

  if (!response.ok) {
    const payload = await readJsonPayload(response);
    throw new Error(payload?.detail || payload?.message || "Server TTS failed");
  }

  const audio = await response.blob();
  return {
    configured: true,
    audio,
    mediaType: response.headers.get("content-type") || audio.type || "audio/mpeg",
  };
}

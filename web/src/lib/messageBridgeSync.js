export function resolveMessageBridgeSessionSync({ status, currentSessionId, busy }) {
  const boundSessionId = status?.enabled ? status?.binding?.local_session_id || "" : "";
  if (!boundSessionId || busy) {
    return { action: "none", sessionId: "" };
  }
  if (currentSessionId !== boundSessionId) {
    return { action: "open", sessionId: boundSessionId };
  }
  return { action: "refresh", sessionId: boundSessionId };
}

function messageId(message) {
  return typeof message?.id === "string" && message.id ? message.id : "";
}

function textValue(value) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function ttsValue(tts, camelName, snakeName) {
  if (!tts) return "";
  return textValue(tts[camelName] ?? tts[snakeName]);
}

function messageSignature(message) {
  const tts = message?.tts || null;
  return [
    messageId(message),
    textValue(message?.role),
    textValue(message?.content),
    textValue(message?.createdAt ?? message?.created_at),
    textValue(message?.traceId ?? message?.trace_id),
    ttsValue(tts, "id", "id"),
    ttsValue(tts, "status", "status"),
    ttsValue(tts, "provider", "provider"),
    ttsValue(tts, "version", "version"),
    ttsValue(tts, "mediaType", "media_type"),
    ttsValue(tts, "remoteAudioUrl", "remote_audio_url"),
    ttsValue(tts, "proxyAudioUrl", "proxy_audio_url"),
    ttsValue(tts, "taskId", "task_id"),
    ttsValue(tts, "error", "error"),
  ].join("\u001f");
}

export function resolveMessageBridgeRefresh({
  currentMessages,
  serverMessages,
  requestLatestOnNewBridgeMessages = false,
}) {
  const knownIds = new Set((currentMessages || []).map(messageId).filter(Boolean));
  const newServerMessages = (serverMessages || []).filter((message) => {
    const id = messageId(message);
    return id && !knownIds.has(id);
  });
  const sameLength = (currentMessages || []).length === (serverMessages || []).length;
  const sameMessages =
    sameLength &&
    (currentMessages || []).every((message, index) => {
      const serverMessage = (serverMessages || [])[index];
      return messageSignature(message) === messageSignature(serverMessage);
    });
  const changed = !sameMessages;

  return {
    changed,
    nextMessages: changed ? serverMessages || [] : currentMessages || [],
    newServerMessages,
    shouldRequestLatest: Boolean(requestLatestOnNewBridgeMessages && newServerMessages.length > 0),
  };
}

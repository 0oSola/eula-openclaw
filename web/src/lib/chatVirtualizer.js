export const CHAT_MESSAGE_ESTIMATED_ROW_HEIGHT = 118;

export function measureChatVirtualRow(element) {
  if (!element) return CHAT_MESSAGE_ESTIMATED_ROW_HEIGHT;
  const scrollHeight = Number(element.scrollHeight) || 0;
  const rectHeight =
    typeof element.getBoundingClientRect === "function" ? Number(element.getBoundingClientRect().height) || 0 : 0;
  return Math.max(CHAT_MESSAGE_ESTIMATED_ROW_HEIGHT, Math.ceil(scrollHeight || rectHeight));
}

export function chatMessageVirtualizerKey(message, index) {
  return message.id || `${message.role}:${message.createdAt || ""}:${index}:${message.content.slice(0, 32)}`;
}

export function chatMessageMeasurementSignature(messages) {
  return messages
    .map((message, index) =>
      [
        chatMessageVirtualizerKey(message, index),
        message.role,
        message.content.length,
        message.createdAt || "",
        message.traceId || "",
        message.tts?.status || "",
      ].join(":"),
    )
    .join("|");
}

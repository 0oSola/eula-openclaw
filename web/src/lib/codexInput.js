export function shouldSendCodexPromptOnKeyDown(event) {
  return event?.key === "Enter" && !event.shiftKey;
}

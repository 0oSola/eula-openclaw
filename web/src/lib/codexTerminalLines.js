const KIND_PROMPTS = {
  assistant: "codex",
  final: "final",
  command: "$",
  output: ">",
  status: "status",
  approval: "approval",
  approval_decision: "decision",
  diff: "diff",
  checks: "checks",
  apply: "apply",
  error: "error",
};

const KIND_TONES = {
  assistant: "primary",
  final: "success",
  command: "command",
  output: "muted",
  status: "notice",
  approval: "warning",
  approval_decision: "notice",
  diff: "accent",
  checks: "success",
  apply: "success",
  error: "danger",
};

function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function formatCodexTerminalTranscript(transcript, context = {}) {
  const items = Array.isArray(transcript) ? transcript : [];
  const lines = [];

  for (const item of items) {
    if (!item) continue;
    const kind = item.kind || "assistant";
    lines.push({
      id: item.id || `${kind}:${lines.length}`,
      prompt: KIND_PROMPTS[kind] || kind,
      tone: KIND_TONES[kind] || "primary",
      turnId: item.turnId || "",
      text: cleanText(item.text),
    });
  }

  if (!items.length) {
    lines.push({
      id: "session:empty",
      prompt: "codex",
      tone: "muted",
      text: `waiting for a turn in ${context.workspaceId || "workspace"}`,
    });
  }

  return lines;
}

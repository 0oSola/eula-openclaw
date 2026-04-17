const META_PATTERN = /<meta\s+emotion="([^"]+)"\s+action="([^"]+)"\s*\/?>/i;

const EMOTIONS = new Set(["neutral", "happy", "sad", "thinking", "excited", "caring"]);
const ACTIONS = new Set(["idle", "nod", "wave", "think", "cheer", "comfort"]);

const DEFAULT_PERSONA = `
You are a browser-based MMD virtual companion.
Speak naturally, warmly, and concisely.
When the user asks for advice, provide actionable steps.
`;

function normalizeBaseUrl(baseUrl) {
  const cleaned = (baseUrl || "").trim().replace(/\/+$/, "");
  if (cleaned.endsWith("/v1")) return cleaned.slice(0, -3);
  return cleaned || "http://127.0.0.1:8443";
}

function inferEmotionAndAction(text) {
  const lower = `${text || ""}`.toLowerCase();
  const hasQuestion = /[?？]/.test(text);
  const happyPattern = /(great|awesome|nice|love|haha|lol|yay|!|太好|开心|哈哈)/i;
  const sadPattern = /(sorry|sad|hurt|worry|anxious|bad|难过|抱歉|担心)/i;
  const excitingPattern = /(wow|amazing|lets go|lfg|加油|冲)/i;

  if (excitingPattern.test(lower)) return { emotion: "excited", action: "cheer" };
  if (happyPattern.test(lower)) return { emotion: "happy", action: "wave" };
  if (sadPattern.test(lower)) return { emotion: "caring", action: "comfort" };
  if (hasQuestion) return { emotion: "thinking", action: "think" };
  return { emotion: "neutral", action: "idle" };
}

function parseAssistantText(rawText) {
  const text = `${rawText || ""}`.trim();
  const metaMatch = text.match(META_PATTERN);

  if (!metaMatch) {
    const fallback = inferEmotionAndAction(text);
    return { text, ...fallback };
  }

  const cleanText = text.replace(META_PATTERN, "").trim();
  const emotion = metaMatch[1]?.toLowerCase();
  const action = metaMatch[2]?.toLowerCase();

  return {
    text: cleanText || "I'm here. Let's keep chatting.",
    emotion: EMOTIONS.has(emotion) ? emotion : "neutral",
    action: ACTIONS.has(action) ? action : "idle",
  };
}

function normalizeMessageContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((entry) => {
        if (typeof entry === "string") return entry;
        if (entry && typeof entry.text === "string") return entry.text;
        if (entry?.type === "text" && typeof entry?.text === "string") return entry.text;
        if (entry?.type === "output_text" && typeof entry?.text === "string") return entry.text;
        return "";
      })
      .join("\n")
      .trim();
  }
  return "";
}

function extractTextFromResponsesPayload(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  const outputList = Array.isArray(payload?.output) ? payload.output : [];
  const chunks = [];

  for (const item of outputList) {
    const contentList = Array.isArray(item?.content) ? item.content : [];
    for (const content of contentList) {
      if (content?.type === "output_text" && typeof content?.text === "string") {
        chunks.push(content.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function buildSystemPrompt(persona) {
  return `
${(persona || DEFAULT_PERSONA).trim()}

At the end of every reply, append exactly one new line in this format:
<meta emotion="neutral|happy|sad|thinking|excited|caring" action="idle|nod|wave|think|cheer|comfort"/>

Rules:
1) Do not include XML tags in the main text except that final meta line.
2) Do not explain the meta line.
3) If uncertain, use emotion="neutral" and action="idle".
`.trim();
}

function buildHeaders(config) {
  const headers = { "Content-Type": "application/json" };
  if (config.token?.trim()) headers.Authorization = `Bearer ${config.token.trim()}`;
  if (config.agentId?.trim()) headers["x-openclaw-agent-id"] = config.agentId.trim();
  if (config.sessionKey?.trim()) headers["x-openclaw-session-key"] = config.sessionKey.trim();
  if (config.messageChannel?.trim()) headers["x-openclaw-message-channel"] = config.messageChannel.trim();
  return headers;
}

function buildEndpoint(config) {
  const base = config.transport === "proxy" ? "/openclaw" : normalizeBaseUrl(config.baseUrl || "");
  if (config.endpoint === "responses") return `${base}/v1/responses`;
  return `${base}/v1/chat/completions`;
}

export async function requestCompanionReply({ history, config, signal }) {
  const endpoint = buildEndpoint(config);
  const headers = buildHeaders(config);
  const persona = buildSystemPrompt(config.persona);
  const condensedHistory = history.slice(-16);

  let payload;
  if (config.endpoint === "responses") {
    const latestUserMessage = [...condensedHistory]
      .reverse()
      .find((message) => message.role === "user")?.content;

    payload = {
      model: config.model || "openclaw/default",
      input: latestUserMessage || "Hello",
      instructions: persona,
      user: config.sessionKey || "mmd-web-session",
      stream: false,
    };
  } else {
    payload = {
      model: config.model || "openclaw/default",
      messages: [{ role: "system", content: persona }, ...condensedHistory],
      stream: false,
      temperature: Number(config.temperature ?? 0.8),
      user: config.sessionKey || "mmd-web-session",
    };
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`OpenClaw request failed (${response.status}): ${errText || "Unknown error"}`);
  }

  const data = await response.json();
  let rawText = "";

  if (config.endpoint === "responses") rawText = extractTextFromResponsesPayload(data);
  else rawText = normalizeMessageContent(data?.choices?.[0]?.message?.content);

  if (!rawText) {
    throw new Error("OpenClaw returned empty content. Check agent/model configuration.");
  }

  const parsed = parseAssistantText(rawText);
  return { ...parsed, raw: rawText };
}

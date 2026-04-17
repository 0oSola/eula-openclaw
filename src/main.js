import "./style.css";
import {
  DEFAULT_MODEL_URL,
  DEFAULT_MOTION_URL,
  MMDCompanion
} from "./mmdCompanion.js";
import { requestCompanionReply } from "./openclawClient.js";

const STORAGE_KEY = "mmd-companion-settings-v1";

const defaults = {
  transport: "direct",
  baseUrl: "http://127.0.0.1:8443",
  token: "",
  endpoint: "chat_completions",
  model: "openclaw/default",
  agentId: "",
  sessionKey: crypto.randomUUID(),
  messageChannel: "feishu",
  temperature: 0.8,
  persona: "You are Companion: warm, proactive, and practical.",
  modelUrl: DEFAULT_MODEL_URL,
  motionUrl: DEFAULT_MOTION_URL,
  ttsEnabled: true
};

const state = {
  settings: { ...defaults },
  history: [],
  loading: false,
  abortController: null
};

const refs = {
  stage: document.querySelector("#stage"),
  stageStatus: document.querySelector("#stage-status"),
  settingsForm: document.querySelector("#settings-form"),
  reloadModelBtn: document.querySelector("#reload-model-btn"),
  messages: document.querySelector("#messages"),
  chatForm: document.querySelector("#chat-form"),
  chatInput: document.querySelector("#chat-input"),
  sendBtn: document.querySelector("#send-btn")
};

const companion = new MMDCompanion({
  container: refs.stage,
  statusElement: refs.stageStatus
});

function loadSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    state.settings = { ...defaults, ...parsed };
  } catch {
    state.settings = { ...defaults };
  }
}

function saveSettings() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.settings));
}

function fillForm(settings) {
  const form = refs.settingsForm;
  for (const [key, value] of Object.entries(settings)) {
    const field = form.elements.namedItem(key);
    if (!field) continue;
    if (field.type === "checkbox") field.checked = Boolean(value);
    else field.value = value ?? "";
  }
}

function readSettingsFromForm() {
  const form = refs.settingsForm;
  const data = new FormData(form);
  return {
    transport: data.get("transport") || "direct",
    baseUrl: `${data.get("baseUrl") || ""}`,
    token: `${data.get("token") || ""}`,
    endpoint: data.get("endpoint") || "chat_completions",
    model: `${data.get("model") || "openclaw/default"}`,
    agentId: `${data.get("agentId") || ""}`,
    sessionKey: `${data.get("sessionKey") || ""}` || crypto.randomUUID(),
    messageChannel: `${data.get("messageChannel") || "feishu"}`,
    temperature: Number(data.get("temperature") || 0.8),
    persona: `${data.get("persona") || defaults.persona}`,
    modelUrl: `${data.get("modelUrl") || DEFAULT_MODEL_URL}`,
    motionUrl: `${data.get("motionUrl") || ""}`,
    ttsEnabled: form.elements.namedItem("ttsEnabled")?.checked ?? false
  };
}

function appendMessage(role, text) {
  const bubble = document.createElement("article");
  bubble.className = `message ${role}`;
  bubble.innerHTML = `<p>${escapeHTML(text)}</p>`;
  refs.messages.appendChild(bubble);
  refs.messages.scrollTop = refs.messages.scrollHeight;
}

function escapeHTML(text) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function setLoading(flag) {
  state.loading = flag;
  refs.sendBtn.disabled = flag;
  refs.sendBtn.textContent = flag ? "Replying..." : "Send";
}

function speak(text) {
  if (!state.settings.ttsEnabled) return;
  if (!("speechSynthesis" in window)) return;

  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = "zh-CN";
  utter.rate = 1.02;
  utter.pitch = 1.12;
  utter.onstart = () => companion.setSpeaking(true);
  utter.onend = () => companion.setSpeaking(false);
  utter.onerror = () => companion.setSpeaking(false);
  window.speechSynthesis.speak(utter);
}

function trimHistory() {
  state.history = state.history.slice(-24);
}

async function sendMessage(text) {
  state.abortController?.abort();
  state.abortController = new AbortController();

  setLoading(true);
  appendMessage("user", text);
  state.history.push({ role: "user", content: text });
  trimHistory();

  companion.reactToUserMessage(text);

  try {
    const reply = await requestCompanionReply({
      history: state.history,
      config: state.settings,
      signal: state.abortController.signal
    });

    appendMessage("assistant", reply.text);
    state.history.push({ role: "assistant", content: reply.text });
    trimHistory();

    companion.applyInteraction({ emotion: reply.emotion, action: reply.action });
    speak(reply.text);
  } catch (error) {
    appendMessage(
      "system",
      `${error?.message || error}\nCheck OpenClaw URL / token / proxy settings.`,
    );
    companion.applyInteraction({ emotion: "sad", action: "comfort" });
  } finally {
    setLoading(false);
    refs.chatInput.focus();
  }
}

async function reloadModel() {
  state.settings = readSettingsFromForm();
  saveSettings();
  await companion.loadModel({
    modelUrl: state.settings.modelUrl,
    motionUrl: state.settings.motionUrl
  });
}

function bindEvents() {
  refs.settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    state.settings = readSettingsFromForm();
    saveSettings();
    appendMessage("system", "Settings saved.");
  });

  refs.reloadModelBtn.addEventListener("click", async () => {
    try {
      await reloadModel();
      appendMessage("system", "Model reloaded.");
    } catch (error) {
      appendMessage("system", `Model reload failed: ${error?.message || error}`);
    }
  });

  refs.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (state.loading) return;
    const text = refs.chatInput.value.trim();
    if (!text) return;
    refs.chatInput.value = "";
    await sendMessage(text);
  });
}

async function bootstrap() {
  loadSettings();
  fillForm(state.settings);
  bindEvents();

  await companion.init({
    modelUrl: state.settings.modelUrl,
    motionUrl: state.settings.motionUrl
  });

  appendMessage("assistant", "Hi. What do you want to talk about?");
}

bootstrap().catch((error) => {
  appendMessage("system", `Bootstrap failed: ${error?.message || error}`);
});


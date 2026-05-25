const DEFAULT_SYLLABLE_SECONDS = 0.22;
const DEFAULT_PAUSE_UNIT = 0.55;
const BILABIAL_INITIALS = new Set(["b", "p", "m"]);
const MANDARIN_INITIALS = [
  "zh",
  "ch",
  "sh",
  "b",
  "p",
  "m",
  "f",
  "d",
  "t",
  "n",
  "l",
  "g",
  "k",
  "h",
  "j",
  "q",
  "x",
  "r",
  "z",
  "c",
  "s",
  "y",
  "w",
];

const PINYIN_TONE_MARKS = {
  ā: "a",
  á: "a",
  ǎ: "a",
  à: "a",
  ē: "e",
  é: "e",
  ě: "e",
  è: "e",
  ī: "i",
  í: "i",
  ǐ: "i",
  ì: "i",
  ō: "o",
  ó: "o",
  ǒ: "o",
  ò: "o",
  ū: "u",
  ú: "u",
  ǔ: "u",
  ù: "u",
  ü: "u",
  ǖ: "u",
  ǘ: "u",
  ǚ: "u",
  ǜ: "u",
};

const COMMON_MANDARIN_PINYIN = {
  一: "yi",
  乙: "yi",
  二: "er",
  三: "san",
  四: "si",
  五: "wu",
  六: "liu",
  七: "qi",
  八: "ba",
  九: "jiu",
  十: "shi",
  的: "de",
  了: "le",
  是: "shi",
  我: "wo",
  你: "ni",
  他: "ta",
  她: "ta",
  它: "ta",
  们: "men",
  不: "bu",
  在: "zai",
  有: "you",
  和: "he",
  就: "jiu",
  人: "ren",
  都: "dou",
  个: "ge",
  上: "shang",
  中: "zhong",
  大: "da",
  为: "wei",
  到: "dao",
  说: "shuo",
  要: "yao",
  去: "qu",
  可: "ke",
  以: "yi",
  会: "hui",
  好: "hao",
  还: "hai",
  没: "mei",
  没: "mei",
  看: "kan",
  想: "xiang",
  能: "neng",
  对: "dui",
  吗: "ma",
  呢: "ne",
  啊: "a",
  吧: "ba",
  着: "zhe",
  给: "gei",
  做: "zuo",
  这: "zhe",
  那: "na",
  里: "li",
  来: "lai",
  回: "hui",
  用: "yong",
  时: "shi",
  候: "hou",
  现: "xian",
  天: "tian",
  今: "jin",
  明: "ming",
  昨: "zuo",
  早: "zao",
  晚: "wan",
  上: "shang",
  下: "xia",
  午: "wu",
  年: "nian",
  月: "yue",
  日: "ri",
  点: "dian",
  分: "fen",
  秒: "miao",
  问: "wen",
  题: "ti",
  可: "ke",
  能: "neng",
  需: "xu",
  需: "xu",
  需: "xu",
  要: "yao",
  已: "yi",
  经: "jing",
  正: "zheng",
  在: "zai",
  开: "kai",
  始: "shi",
  完: "wan",
  成: "cheng",
  成: "cheng",
  功: "gong",
  失: "shi",
  败: "bai",
  请: "qing",
  稍: "shao",
  等: "deng",
  继: "ji",
  续: "xu",
  默: "mo",
  认: "ren",
  参: "can",
  数: "shu",
  配: "pei",
  置: "zhi",
  渲: "xuan",
  染: "ran",
  模: "mo",
  式: "shi",
  相: "xiang",
  机: "ji",
  镜: "jing",
  头: "tou",
  语: "yu",
  音: "yin",
  播: "bo",
  放: "fang",
  嘴: "zui",
  巴: "ba",
  口: "kou",
  型: "xing",
  同: "tong",
  步: "bu",
  波: "bo",
  形: "xing",
  幅: "fu",
  度: "du",
  音: "yin",
  素: "su",
  中: "zhong",
  文: "wen",
  拼: "pin",
  母: "mu",
  声: "sheng",
  韵: "yun",
  妈: "ma",
  爸: "ba",
  哥: "ge",
  姐: "jie",
  先: "xian",
  生: "sheng",
  女: "nu",
  孩: "hai",
  朋: "peng",
  友: "you",
  家: "jia",
  工: "gong",
  作: "zuo",
  项: "xiang",
  目: "mu",
  文: "wen",
  件: "jian",
  接: "jie",
  口: "kou",
  服: "fu",
  务: "wu",
  数: "shu",
  据: "ju",
  库: "ku",
  查: "cha",
  询: "xun",
  更: "geng",
  新: "xin",
  刷: "shua",
  拉: "la",
  取: "qu",
  发: "fa",
  送: "song",
  收: "shou",
  消: "xiao",
  息: "xi",
  聊: "liao",
  视: "shi",
  像: "xiang",
  动: "dong",
  作: "zuo",
  舞: "wu",
  台: "tai",
  角: "jiao",
  色: "se",
  皮: "pi",
  肤: "fu",
  颜: "yan",
  色: "se",
};

function roundTime(value) {
  return Number(Math.max(0, Number(value) || 0).toFixed(6));
}

function isCjkCharacter(value) {
  return /^[\u3400-\u9fff]$/u.test(value);
}

function isPauseCharacter(value) {
  return /^[\s，。！？、；：,.!?;:]$/u.test(value);
}

function normalizePinyin(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[āáǎàēéěèīíǐìōóǒòūúǔùüǖǘǚǜ]/g, (match) => PINYIN_TONE_MARKS[match] || match)
    .replace(/v/g, "u")
    .replace(/[^a-z]/g, "");
}

function splitMandarinInitial(syllable) {
  const normalized = normalizePinyin(syllable);
  for (const initial of MANDARIN_INITIALS) {
    if (normalized.startsWith(initial) && normalized.length > initial.length) {
      return { initial, final: normalized.slice(initial.length) };
    }
  }
  return { initial: "", final: normalized };
}

function visemeStepsForFinal(final) {
  const normalized = normalizePinyin(final);
  if (!normalized) return ["A"];
  if (normalized === "er") return ["E"];
  if (normalized.includes("iao")) return ["I", "A", "O"];
  if (normalized.includes("iang") || normalized.includes("ian")) return ["I", "A"];
  if (normalized.includes("ie")) return ["I", "E"];
  if (normalized.includes("iong")) return ["I", "O"];
  if (normalized.includes("ao")) return ["A", "O"];
  if (normalized.includes("ou")) return ["O"];
  if (normalized.includes("uo")) return ["U", "O"];
  if (normalized.includes("ua") || normalized.includes("uai") || normalized.includes("uan") || normalized.includes("uang")) {
    return ["U", "A"];
  }
  if (normalized.includes("ong")) return ["O"];
  if (normalized.includes("ang") || normalized.includes("an") || normalized.includes("ai") || normalized.includes("a")) return ["A"];
  if (normalized.includes("eng") || normalized.includes("en") || normalized.includes("ei") || normalized.includes("e")) return ["E"];
  if (normalized.includes("ing") || normalized.includes("in") || normalized.includes("i")) return ["I"];
  if (normalized.includes("u")) return ["U"];
  if (normalized.includes("o")) return ["O"];
  return ["A"];
}

export function pinyinToVisemeSteps(syllable) {
  const { initial, final } = splitMandarinInitial(syllable);
  const steps = visemeStepsForFinal(final || syllable);
  if (BILABIAL_INITIALS.has(initial) && steps[0] !== "M") {
    return ["M", ...steps];
  }
  return steps;
}

function fallbackUnknownCjkViseme(character) {
  const code = character.codePointAt(0) || 0;
  return ["A", "I", "U", "E", "O"][code % 5];
}

function tokenToVisemeSteps(token) {
  if (token.kind === "pause") return ["sil"];
  if (token.pinyin) return pinyinToVisemeSteps(token.pinyin);
  if (token.text && /^[a-z]+$/i.test(token.text)) {
    return visemeStepsForFinal(token.text);
  }
  if (token.character) return [fallbackUnknownCjkViseme(token.character)];
  return ["A"];
}

function tokenizeSpeechText(text) {
  const tokens = [];
  const source = String(text || "");
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (isPauseCharacter(character)) {
      tokens.push({ kind: "pause", unit: DEFAULT_PAUSE_UNIT });
      index += 1;
      continue;
    }
    if (isCjkCharacter(character)) {
      tokens.push({
        kind: "syllable",
        character,
        pinyin: COMMON_MANDARIN_PINYIN[character] || "",
        unit: 1,
      });
      index += 1;
      continue;
    }
    if (/[a-zA-ZüÜvV]/.test(character)) {
      let end = index + 1;
      while (end < source.length && /[a-zA-ZüÜvV0-9]/.test(source[end])) end += 1;
      tokens.push({ kind: "syllable", text: source.slice(index, end), unit: 1 });
      index = end;
      continue;
    }
    index += 1;
  }
  return tokens;
}

export function buildSpeechVisemeTimeline(text, { durationSeconds = 0, syllableSeconds = DEFAULT_SYLLABLE_SECONDS } = {}) {
  const tokens = tokenizeSpeechText(text);
  if (!tokens.length) return [];

  const totalUnits = tokens.reduce((sum, token) => sum + (Number(token.unit) || 1), 0);
  const hasDuration = Number.isFinite(Number(durationSeconds)) && Number(durationSeconds) > 0;
  const totalDuration = hasDuration ? Number(durationSeconds) : totalUnits * syllableSeconds;
  const timeline = [];
  let cursor = 0;

  for (const token of tokens) {
    const unit = Number(token.unit) || 1;
    const slotDuration = hasDuration ? (totalDuration * unit) / totalUnits : unit * syllableSeconds;
    const steps = tokenToVisemeSteps(token);
    const stepDuration = slotDuration / Math.max(1, steps.length);
    for (const [stepIndex, viseme] of steps.entries()) {
      timeline.push({
        time: roundTime(cursor + stepIndex * stepDuration),
        viseme,
        weight: viseme === "sil" ? 0 : token.pinyin || token.text ? 0.82 : 0.55,
      });
    }
    cursor += slotDuration;
  }

  timeline.push({ time: roundTime(totalDuration), viseme: "sil", weight: 0 });
  return timeline;
}

export function normalizeSpeechVisemeFrame(frame) {
  if (!frame) return null;
  const viseme = String(frame.viseme || frame.value || "").trim();
  if (!viseme) return null;
  const normalized = viseme.toLowerCase() === "sil" || viseme.toLowerCase() === "silence" ? "sil" : viseme.toUpperCase();
  const weight = Number(frame.weight);
  return {
    viseme: normalized,
    weight: Number.isFinite(weight) ? Math.min(1, Math.max(0, weight)) : normalized === "sil" ? 0 : 0.75,
  };
}

export function sampleSpeechViseme(timeline, currentTime) {
  if (!Array.isArray(timeline) || !timeline.length) return normalizeSpeechVisemeFrame({ viseme: "sil", weight: 0 });
  const time = Math.max(0, Number(currentTime) || 0);
  let selected = timeline[0];
  for (const frame of timeline) {
    if (Number(frame.time) > time) break;
    selected = frame;
  }
  return normalizeSpeechVisemeFrame(selected);
}

export function createSpeechVisemeSync({
  audio,
  text = "",
  timeline = null,
  durationSeconds = 0,
  setViseme,
  requestAnimationFrame = globalThis.requestAnimationFrame?.bind(globalThis),
  cancelAnimationFrame = globalThis.cancelAnimationFrame?.bind(globalThis),
} = {}) {
  if (!audio || typeof setViseme !== "function") {
    return {
      setTimeline() {},
      start() {},
      stop() {},
    };
  }

  let active = false;
  let disposed = false;
  let frameId = null;
  let resolvedTimeline = Array.isArray(timeline) ? timeline : null;

  const cancelFrame = () => {
    if (frameId !== null) {
      cancelAnimationFrame?.(frameId);
      frameId = null;
    }
  };

  const ensureTimeline = () => {
    if (Array.isArray(resolvedTimeline)) return resolvedTimeline;
    const audioDuration = Number(audio.duration);
    const resolvedDuration = Number.isFinite(audioDuration) && audioDuration > 0 ? audioDuration : durationSeconds;
    resolvedTimeline = buildSpeechVisemeTimeline(text, { durationSeconds: resolvedDuration });
    return resolvedTimeline;
  };

  const readViseme = () => {
    if (!active || disposed) return;
    frameId = null;
    const nextTimeline = ensureTimeline();
    if (nextTimeline.length) {
      setViseme(sampleSpeechViseme(nextTimeline, audio.currentTime || 0));
    }
    if (!audio.paused && !audio.ended && requestAnimationFrame) {
      frameId = requestAnimationFrame(readViseme);
    }
  };

  const setTimeline = (nextTimeline) => {
    resolvedTimeline = Array.isArray(nextTimeline) ? nextTimeline : null;
    if (active) readViseme();
  };

  const start = () => {
    active = true;
    readViseme();
  };

  const stop = () => {
    active = false;
    disposed = true;
    cancelFrame();
    setViseme(null);
  };

  return { setTimeline, start, stop };
}

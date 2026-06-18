const FRAME_KIND_TO_FIELD = {
  start: "startFrame",
  target: "targetFrame",
  hold: "holdFrame",
  reset: "resetFrame",
};

function parseCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      cells.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function readNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function readInteger(value, fallback = 0) {
  const next = Number.parseInt(value, 10);
  return Number.isFinite(next) ? next : fallback;
}

export function parseScheduleCsv(text) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  if (!lines.length) return [];

  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, index) => [header, cells[index] ?? ""]));
    return {
      testNo: readInteger(row.test_no),
      bone: row.bone || "",
      axis: (row.axis || "").toUpperCase(),
      sign: row.sign === "-" ? "-" : "+",
      amount: readNumber(row.degree ?? row.amount),
      startFrame: readInteger(row.start_frame),
      targetFrame: readInteger(row.target_frame),
      holdFrame: readInteger(row.hold_frame),
      resetFrame: readInteger(row.reset_frame),
      note: row.note || "",
    };
  });
}

function sanitizePathSegment(value) {
  return String(value || "")
    .trim()
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "") || "unnamed";
}

function padFrame(frame) {
  return String(Math.max(0, readInteger(frame))).padStart(4, "0");
}

export function formatCaptureFilename({ group, testNo, bone, axis, sign, frameKind, frame }) {
  const direction = sign === "-" ? "minus" : "plus";
  const filename = [
    String(Math.max(0, readInteger(testNo))).padStart(3, "0"),
    sanitizePathSegment(bone),
    sanitizePathSegment(axis || "axis"),
    direction,
    sanitizePathSegment(frameKind),
    `f${padFrame(frame)}`,
  ].join("-");
  return `${sanitizePathSegment(group)}/${filename}.png`;
}

export function buildAxisCalibrationCapturePlan({ schedules, frameKinds = ["target", "hold"] }) {
  const steps = [];
  let totalCaptures = 0;

  for (const schedule of schedules || []) {
    const rows = Array.isArray(schedule.rows) ? schedule.rows : parseScheduleCsv(schedule.csvText || "");
    const captures = [];
    for (const row of rows) {
      for (const frameKind of frameKinds) {
        const frameField = FRAME_KIND_TO_FIELD[frameKind];
        if (!frameField) continue;
        const frame = row[frameField];
        captures.push({
          ...row,
          group: schedule.group,
          frameKind,
          frame,
          outputPath: formatCaptureFilename({
            group: schedule.group,
            testNo: row.testNo,
            bone: row.bone,
            axis: row.axis,
            sign: row.sign,
            frameKind,
            frame,
          }),
        });
      }
    }
    totalCaptures += captures.length;
    steps.push({
      group: schedule.group,
      vmdPath: schedule.vmdPath,
      captures,
    });
  }

  return { steps, totalCaptures };
}

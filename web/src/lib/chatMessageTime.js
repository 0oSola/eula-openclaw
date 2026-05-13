function pad2(value) {
  return String(value).padStart(2, "0");
}

function isSameLocalDate(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function formatChatMessageTime(value, now = new Date()) {
  const parsed = Date.parse(value || "");
  if (Number.isNaN(parsed)) return "--:--";

  const date = new Date(parsed);
  const time = `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
  if (isSameLocalDate(date, now)) return time;

  const monthDay = `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
  if (date.getFullYear() === now.getFullYear()) return `${monthDay} ${time}`;

  return `${date.getFullYear()}-${monthDay} ${time}`;
}

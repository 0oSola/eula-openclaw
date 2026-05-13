import test from "node:test";
import assert from "node:assert/strict";

import { formatChatMessageTime } from "../src/lib/chatMessageTime.js";

test("formatChatMessageTime uses compact chat timestamps relative to local today", () => {
  const now = new Date(2026, 4, 11, 18, 30);

  assert.equal(formatChatMessageTime("2026-05-11T06:05:00.000Z", now), "14:05");
  assert.equal(formatChatMessageTime("2026-05-10T13:34:00.000Z", now), "05-10 21:34");
  assert.equal(formatChatMessageTime("2025-12-31T15:59:00.000Z", now), "2025-12-31 23:59");
  assert.equal(formatChatMessageTime("", now), "--:--");
  assert.equal(formatChatMessageTime("not-a-date", now), "--:--");
});

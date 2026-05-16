import test from "node:test";
import assert from "node:assert/strict";

let chatVirtualizer;
try {
  chatVirtualizer = await import("../src/lib/chatVirtualizer.js");
} catch (error) {
  assert.fail(`chat virtualizer helper should be importable: ${error.message}`);
}

const {
  CHAT_MESSAGE_ESTIMATED_ROW_HEIGHT,
  chatMessageMeasurementSignature,
  chatMessageVirtualizerKey,
  measureChatVirtualRow,
} = chatVirtualizer;

test("measureChatVirtualRow uses scrollHeight so long wrapped messages reserve their real height", () => {
  const element = {
    scrollHeight: 246,
    getBoundingClientRect() {
      return { height: 118 };
    },
  };

  assert.equal(measureChatVirtualRow(element), 246);
});

test("measureChatVirtualRow keeps a sane estimate for hidden or unmeasured rows", () => {
  const element = {
    scrollHeight: 0,
    getBoundingClientRect() {
      return { height: 0 };
    },
  };

  assert.equal(measureChatVirtualRow(element), CHAT_MESSAGE_ESTIMATED_ROW_HEIGHT);
});

test("chat virtualizer keys and signatures change when rendered content height can change", () => {
  const messages = [
    { id: "server-1", role: "assistant", content: "short", createdAt: "2026-05-15T03:00:00Z" },
    { role: "assistant", content: "long ".repeat(40), createdAt: "2026-05-15T03:01:00Z", tts: { status: "pending" } },
  ];
  const changed = [
    messages[0],
    { ...messages[1], content: `${messages[1].content} extra`, tts: { status: "ready" }, traceId: "trace-1" },
  ];

  assert.equal(chatMessageVirtualizerKey(messages[0], 0), "server-1");
  assert.notEqual(chatMessageMeasurementSignature(messages), chatMessageMeasurementSignature(changed));
});

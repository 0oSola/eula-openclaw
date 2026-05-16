import test from "node:test";
import assert from "node:assert/strict";

let chatAutoScroll;
try {
  chatAutoScroll = await import("../src/lib/chatAutoScroll.js");
} catch (error) {
  assert.fail(`chat auto-scroll helper should be importable: ${error.message}`);
}

const { CHAT_BOTTOM_THRESHOLD_PX, isChatListNearBottom, shouldAutoScrollChatList } = chatAutoScroll;

test("isChatListNearBottom treats small bottom gaps as pinned to latest", () => {
  assert.equal(
    isChatListNearBottom({
      scrollHeight: 1000,
      scrollTop: 1000 - 500 - CHAT_BOTTOM_THRESHOLD_PX,
      clientHeight: 500,
    }),
    true,
  );

  assert.equal(
    isChatListNearBottom({
      scrollHeight: 1000,
      scrollTop: 1000 - 500 - CHAT_BOTTOM_THRESHOLD_PX - 1,
      clientHeight: 500,
    }),
    false,
  );
});

test("shouldAutoScrollChatList scrolls when a send flow explicitly requests latest", () => {
  assert.equal(
    shouldAutoScrollChatList({
      previousVisibleMessageCount: 8,
      nextVisibleMessageCount: 9,
      wasNearBottomBeforeUpdate: false,
      autoScrollRequested: true,
    }),
    true,
  );
});

test("shouldAutoScrollChatList preserves history position unless the list was already pinned", () => {
  assert.equal(
    shouldAutoScrollChatList({
      previousVisibleMessageCount: 8,
      nextVisibleMessageCount: 9,
      wasNearBottomBeforeUpdate: true,
      autoScrollRequested: false,
    }),
    true,
  );

  assert.equal(
    shouldAutoScrollChatList({
      previousVisibleMessageCount: 8,
      nextVisibleMessageCount: 9,
      wasNearBottomBeforeUpdate: false,
      autoScrollRequested: false,
    }),
    false,
  );
});

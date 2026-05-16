import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const chatboxSource = readFileSync(new URL("../src/app/companion/CompanionChatbox.tsx", import.meta.url), "utf8");
const cssSource = readFileSync(new URL("../src/app/globals.css", import.meta.url), "utf8");

function cssBlock(selector) {
  const start = cssSource.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `${selector} CSS block should exist`);
  const bodyStart = cssSource.indexOf("{", start);
  const bodyEnd = cssSource.indexOf("}", bodyStart);
  return cssSource.slice(bodyStart + 1, bodyEnd);
}

test("chatbox messages use normal flow rows so wrapped content cannot overlap", () => {
  assert.match(chatboxSource, /className="mio-chatbox-message-flow"/);
  assert.match(chatboxSource, /visibleMessages\.map/);
  assert.doesNotMatch(chatboxSource, /useVirtualizer/);
  assert.doesNotMatch(chatboxSource, /getVirtualItems\(\)/);
  assert.doesNotMatch(chatboxSource, /mio-chatbox-virtual-row/);
  assert.match(cssSource, /\.mio-chatbox-message-flow\s*\{[\s\S]*?display:\s*grid;[\s\S]*?gap:\s*8px;/);
  assert.doesNotMatch(cssSource, /\.mio-chatbox-virtual-row\s*\{[\s\S]*?position:\s*absolute;/);
});

test("chatbox list does not expose horizontal overflow that breaks its border", () => {
  assert.match(cssBlock(".mio-chatbox-list"), /overflow-x:\s*hidden;/);
  assert.match(cssBlock(".mio-chatbox-message-flow"), /min-width:\s*0;/);
  assert.match(cssBlock(".mio-chatbox-message,\n.mio-chatbox-empty"), /max-width:\s*100%;/);
});

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop pet drag region css", () => {
  it("does not use app-region drag because it hijacks right click on Windows", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(css).not.toMatch(/-webkit-app-region:\s*drag/);
  });
});

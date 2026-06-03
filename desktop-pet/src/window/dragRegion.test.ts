import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop pet drag region css", () => {
  it("uses native app-region drag in whole-window drag mode", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(css).toMatch(
      /\.pet-shell\[data-interaction-mode="window-drag"\]\s*{[^}]*-webkit-app-region:\s*drag/s,
    );
    expect(css).toMatch(
      /\.pet-shell\[data-interaction-mode="window-drag"\]\s+canvas[^{]*{[^}]*-webkit-app-region:\s*drag/s,
    );
  });

  it("keeps the MMD stage interactive in camera-adjust mode", () => {
    const css = readFileSync(path.resolve(__dirname, "../styles.css"), "utf8");

    expect(css).toMatch(/\.pet-shell\[data-interaction-mode="camera-adjust"\][^{]*{[^}]*-webkit-app-region:\s*no-drag/s);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("responsive contract", () => {
  it("defines structural desktop breakpoints without viewport-based font scaling", () => {
    const css = readFileSync("src/styles/shell.css", "utf8");
    expect(css).toContain("@media (max-width: 1040px)");
    expect(css).toContain("grid-template-columns");
    expect(css).not.toMatch(/font-size:\s*(?:clamp|[\d.]+vw)/u);
  });

  it("lays out template cards as a responsive multi-column grid", () => {
    const css = readFileSync("src/styles/pages.css", "utf8");
    const block = css.match(/\.template-grid\s*\{([^}]*)\}/u)?.[1] ?? "";

    expect(block).toMatch(/display:\s*grid/u);
    expect(block).toMatch(/grid-template-columns:\s*repeat\(auto-fill,\s*minmax\(/u);
  });
});

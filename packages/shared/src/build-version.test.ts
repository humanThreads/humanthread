import { describe, expect, it } from "vitest";
import { formatBuildVersion } from "./build-version";

describe("formatBuildVersion", () => {
  it("formats a semantic version and bounded git revision", () => {
    expect(formatBuildVersion("Agent", "0.1.2", "E16BFF4C12345678"))
      .toBe("Agent v0.1.2 · e16bff4c");
  });

  it("omits an unavailable or unsafe revision", () => {
    expect(formatBuildVersion("Web", "0.1.2", ""))
      .toBe("Web v0.1.2");
    expect(formatBuildVersion("Web", "0.1.2", "release/main"))
      .toBe("Web v0.1.2");
  });
});

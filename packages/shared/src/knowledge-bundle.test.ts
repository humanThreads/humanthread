import { describe, expect, it } from "vitest";

import { validateArchitectureBundle } from "./knowledge-bundle";

const valid = `<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px sans-serif}</style></head><body><div id="root"></div><script>window.parent.postMessage({type:"humanthread:architecture:ready",nonce:"x"},"*")</script></body></html>`;

describe("validateArchitectureBundle", () => {
  it("accepts a self-contained single-file bundle", () => {
    const result = validateArchitectureBundle({ fileName: "index.htm", content: valid });
    expect(result).toMatchObject({ fileName: "index.htm", byteSize: expect.any(Number) });
    expect(result.contentDigest).toMatch(/^[a-f0-9]{32}$/u);
  });

  it("rejects remote scripts, remote styles, and network access", () => {
    expect(() => validateArchitectureBundle({ fileName: "index.htm", content: '<script src="https://evil.example/x.js"></script>' })).toThrow();
    expect(() => validateArchitectureBundle({ fileName: "index.htm", content: '<link rel="stylesheet" href="https://evil.example/x.css">' })).toThrow();
    expect(() => validateArchitectureBundle({ fileName: "index.htm", content: '<img src="https://evil.example/p.png">' })).toThrow();
  });

  it("rejects non-htm files, empty content, oversized bundles, and iframe escapes", () => {
    expect(() => validateArchitectureBundle({ fileName: "index.html", content: valid })).toThrow();
    expect(() => validateArchitectureBundle({ fileName: "index.htm", content: "" })).toThrow();
    expect(() => validateArchitectureBundle({ fileName: "index.htm", content: "x".repeat(1_000_001) })).toThrow();
    expect(() => validateArchitectureBundle({ fileName: "index.htm", content: `${valid}<iframe src="https://evil.example"></iframe>` })).toThrow();
    expect(() => validateArchitectureBundle({ fileName: "index.htm", content: `${valid}<base href="https://evil.example">` })).toThrow();
  });
});

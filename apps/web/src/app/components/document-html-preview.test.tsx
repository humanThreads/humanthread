import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentHtmlPreview } from "./document-html-preview";

describe("DocumentHtmlPreview", () => {
  it("uses an isolated iframe without same-origin or script permissions", () => {
    const markup = renderToStaticMarkup(
      <DocumentHtmlPreview title="原型" html={'<button>点击</button><script>alert(1)</script>'} />,
    );
    expect(markup).toContain("sandbox=");
    expect(markup).not.toContain("allow-same-origin");
    expect(markup).not.toContain("allow-scripts");
    expect(markup).toContain("原型");
  });
});

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { McpCredentialForm } from "./mcp-credential-form";

describe("MCP credential form", () => {
  it("renders a credential name input and generate button", () => {
    const markup = renderToStaticMarkup(<McpCredentialForm />);

    expect(markup).toContain("凭据名称");
    expect(markup).toContain("生成凭据");
  });
});

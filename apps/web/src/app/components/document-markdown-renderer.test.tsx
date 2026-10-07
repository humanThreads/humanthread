import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DocumentMarkdownRenderer } from "./document-markdown-renderer";

describe("DocumentMarkdownRenderer", () => {
  it("renders GFM tables, tasks and fenced code", () => {
    const markup = renderToStaticMarkup(
      <DocumentMarkdownRenderer
        markdown={[
          "# Guide",
          "",
          "- [x] Ready",
          "",
          "| Name | State |",
          "| --- | --- |",
          "| API | Ready |",
          "",
          "```ts",
          "const ok = true;",
          "```",
        ].join("\n")}
      />,
    );
    expect(markup).toContain("<table");
    expect(markup).toContain('type="checkbox"');
    expect(markup).toContain("contains-task-list");
    expect(markup).toContain("list-disc");
    expect(markup).toContain("const ok = true;");
  });

  it("preserves intentional single line breaks in compact documents", () => {
    const markup = renderToStaticMarkup(
      <DocumentMarkdownRenderer markdown={"**Goal:** Ship safely.\n**Architecture:** Keep one source."} />,
    );

    expect(markup).toContain("<br/>");
  });

  it("renders pasted unicode bullets as a real list without changing code blocks", () => {
    const markup = renderToStaticMarkup(
      <DocumentMarkdownRenderer markdown={"• First\n• Second\n\n```text\n• literal\n```"} />,
    );

    expect(markup).toContain("<li");
    expect(markup).toContain("First");
    expect(markup).toContain("• literal");
  });

  it("does not execute raw html and secures external links", () => {
    const markup = renderToStaticMarkup(
      <DocumentMarkdownRenderer
        markdown={'<script>alert(1)</script>\n\n[Open](https://example.com)'}
      />,
    );
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer noopener"');
  });

  it("renders Mermaid flowcharts as a diagram region", () => {
    const markup = renderToStaticMarkup(
      <DocumentMarkdownRenderer markdown={'```mermaid\ngraph TD\n  A[开始] --> B[结束]\n```'} />,
    );
    expect(markup).toContain('data-diagram="mermaid"');
    expect(markup).toContain("开始");
    expect(markup).toContain("结束");
  });

  it("renders XMind and Visio attachment links as protected preview surfaces", () => {
    const markup = renderToStaticMarkup(
      <DocumentMarkdownRenderer
        markdown={[
          "[产品路线图.xmind](/api/document-attachments/attachment_xmind)",
          "",
          "[审批流程.vsdx](/api/document-attachments/attachment_vsdx)",
        ].join("\n")}
      />,
    );

    expect(markup).toContain('data-document-preview="xmind"');
    expect(markup).toContain('data-document-preview="vsdx"');
    expect(markup).toContain("产品路线图.xmind");
    expect(markup).toContain("审批流程.vsdx");
    expect(markup).toContain("/api/document-attachments/attachment_xmind");
    expect(markup).toContain("/api/document-attachments/attachment_vsdx");
  });
});

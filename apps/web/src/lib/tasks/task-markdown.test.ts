import { describe, expect, it } from "vitest";
import { markdownToTaskEditorContent, taskEditorContentToMarkdown } from "./task-markdown";

describe("Task Markdown conversion", () => {
  const markdown = [
    "# 发布计划",
    "",
    "正文包含 [运行手册](https://example.com/runbook) 和图片：",
    "",
    "![架构图](https://example.com/architecture.png)",
    "",
    "> 先完成安全检查。",
    "",
    "- 普通事项",
    "- [x] 已完成",
    "- [ ] 待处理",
    "",
    "1. 准备",
    "2. 发布",
    "",
    "| 环境 | 状态 |",
    "| --- | --- |",
    "| 内部 | 就绪 |",
    "",
    "```ts",
    "const ready = true;",
    "```",
  ].join("\n");

  it("parses headings, tables, code, links, images, quotes and lists", () => {
    const content = markdownToTaskEditorContent(markdown);
    const serialized = JSON.stringify(content);

    expect(serialized).toContain('"type":"heading"');
    expect(serialized).toContain('"type":"table"');
    expect(serialized).toContain('"type":"codeBlock"');
    expect(serialized).toContain('"language":"ts"');
    expect(serialized).toContain('"type":"blockquote"');
    expect(serialized).toContain('"type":"taskList"');
    expect(serialized).toContain('"type":"image"');
    expect(serialized).toContain('"type":"link"');
  });

  it("keeps normalized Markdown stable after repeated rich-editor round trips", () => {
    const normalized = taskEditorContentToMarkdown(markdownToTaskEditorContent(markdown));
    const repeated = taskEditorContentToMarkdown(markdownToTaskEditorContent(normalized));

    expect(repeated).toBe(normalized);
    expect(normalized).toContain("```ts");
    expect(normalized).toMatch(/\|\s*环境\s*\|\s*状态\s*\|/u);
    expect(normalized).toContain("- [x] 已完成");
    expect(normalized).toContain("![架构图](https://example.com/architecture.png)");
  });
});

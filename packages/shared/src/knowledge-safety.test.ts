import { describe, expect, it } from "vitest";

import { KNOWLEDGE_BATCH_ITEM_LIMIT, KNOWLEDGE_BATCH_STATUSES } from "./knowledge";
import { scanKnowledgeSensitiveValue, scanKnowledgeSensitiveText } from "./knowledge-safety";

describe("knowledge sensitive-content scanning", () => {
  it("publishes the shared Stage 1 batch bounds and cancelled status", () => {
    expect(KNOWLEDGE_BATCH_ITEM_LIMIT).toBe(500);
    expect(KNOWLEDGE_BATCH_STATUSES).toContain("cancelled");
  });

  it("detects and redacts credentials, email addresses, and phone numbers", () => {
    const input = [
      `Authorization: Bearer ${"a".repeat(24)}`,
      `API_KEY=sk-${"x".repeat(32)}`,
      "owner@example.com",
      "13800138000",
    ].join("\n");

    const result = scanKnowledgeSensitiveText(input);

    expect(result.redactionResult).toEqual({
      status: "sensitive_content_detected",
      redactionCount: 4,
    });
    expect(result.safeContent).not.toContain("Bearer ");
    expect(result.safeContent).not.toContain("sk-");
    expect(result.safeContent).not.toContain("owner@example.com");
    expect(result.safeContent).not.toContain("13800138000");
    expect(result.safeContent.match(/\[REDACTED\]/gu)).toHaveLength(4);
  });

  it("redacts nested submitted values without changing their shape", () => {
    const result = scanKnowledgeSensitiveValue({
      title: "发布说明",
      evidence: [{ kind: "log", ref: "token=secret-value" }, 42, null],
    });

    expect(result.redactionResult).toMatchObject({ status: "sensitive_content_detected" });
    expect(result.safeValue).toEqual({
      title: "发布说明",
      evidence: [{ kind: "log", ref: "token=[REDACTED]" }, 42, null],
    });
  });

  it("leaves clean values unchanged", () => {
    expect(scanKnowledgeSensitiveText("发布前必须运行测试。")).toEqual({
      safeContent: "发布前必须运行测试。",
      redactionResult: { status: "clean", redactionCount: 0 },
    });
  });
});

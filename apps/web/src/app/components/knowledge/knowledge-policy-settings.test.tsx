// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { KnowledgePolicySettings } from "./knowledge-policy-settings";

afterEach(cleanup);

const policy = {
  autoPublishEnabled: false,
  minimumConfidence: 0.9,
  allowedSourceTypes: [] as string[],
  allowedEntryTypes: [] as string[],
  allowAutomaticDelete: false,
  allowAutomaticExpire: false,
  allowAutomaticSupersede: false,
  subscribeSpaceKnowledge: false,
  version: 1,
};

describe("KnowledgePolicySettings", () => {
  it("shows the current automatic review state", () => {
    render(<KnowledgePolicySettings projectId="project_1" initialPolicy={policy} />);

    expect(screen.getByText("未启用")).toBeTruthy();
    expect(screen.getByText("策略版本 v1")).toBeTruthy();
  });

  it("saves source and entry type allowlists with the expected version", async () => {
    const save = vi.fn().mockResolvedValue({
      ...policy,
      autoPublishEnabled: true,
      allowedSourceTypes: ["knowledge_architecture"],
      allowedEntryTypes: ["rule"],
      version: 2,
    });
    render(<KnowledgePolicySettings projectId="project_1" initialPolicy={policy} api={{ save, reload: vi.fn() }} />);

    await userEvent.click(screen.getByLabelText("启用自动审核"));
    await userEvent.click(screen.getByLabelText("架构文档"));
    await userEvent.click(screen.getByLabelText("规则"));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 1,
      autoPublishEnabled: true,
      allowedSourceTypes: ["knowledge_architecture"],
      allowedEntryTypes: ["rule"],
    })));
    expect(screen.getByText("已保存")).toBeTruthy();
    expect(screen.getByText("策略版本 v2")).toBeTruthy();
  });

  it("surfaces backend validation failures without losing the form", async () => {
    const save = vi.fn().mockRejectedValue(new Error("自动审核启用前至少选择一个来源类型"));
    render(<KnowledgePolicySettings projectId="project_1" initialPolicy={policy} api={{ save, reload: vi.fn() }} />);

    await userEvent.click(screen.getByLabelText("启用自动审核"));
    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toContain("自动审核启用前至少选择一个来源类型"));
    expect(screen.getByLabelText("启用自动审核")).toHaveProperty("checked", true);
  });

  it("refreshes to the latest policy version after a concurrent update", async () => {
    const save = vi.fn().mockRejectedValue(
      Object.assign(new Error("Knowledge policy changed while updating"), { code: "version_conflict" }),
    );
    const reload = vi.fn().mockResolvedValue({
      ...policy,
      autoPublishEnabled: true,
      allowedSourceTypes: ["knowledge_architecture"],
      allowedEntryTypes: ["rule"],
      version: 7,
    });
    render(<KnowledgePolicySettings projectId="project_1" initialPolicy={policy} api={{ save, reload }} />);

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(reload).toHaveBeenCalled());
    expect(screen.getByText("策略版本 v7")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("已刷新到最新版本 v7");
    expect(screen.queryByRole("alert")).toBeNull();
    // The user's in-progress edits are preserved so they can retry immediately.
    expect(screen.getByLabelText("启用自动审核")).toHaveProperty("checked", false);
  });

  it("reports a retryable message when the server returns an empty body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 502 })));
    render(<KnowledgePolicySettings projectId="project_1" initialPolicy={policy} />);

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toContain("服务暂时不可用，请稍后重试"));
    vi.unstubAllGlobals();
  });

  it("reports a retryable message when the server returns a non-JSON body", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 })));
    render(<KnowledgePolicySettings projectId="project_1" initialPolicy={policy} />);

    await userEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => expect(screen.getByRole("alert").textContent)
      .toContain("服务返回了无法解析的响应，请稍后重试"));
    vi.unstubAllGlobals();
  });
});

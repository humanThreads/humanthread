// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LoopDefinitionLifecycle } from "./loop-definition-lifecycle";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const lifecycle = {
  canArchive: true,
  canDelete: false,
  referenceCount: 2,
  references: { versions: 1, bindings: 1, runs: 0, receipts: 0, grants: 0 },
};

describe("LoopDefinitionLifecycle", () => {
  it("renders no mutation actions for Platform definitions", () => {
    render(<LoopDefinitionLifecycle
      definitionId="loop_platform"
      draftRevision={3}
      origin="platform"
      status="published"
      lifecycle={{ ...lifecycle, canArchive: false }}
      api={{ mutate: vi.fn() }}
    />);

    expect(screen.queryByRole("button", { name: "归档 Loop" })).toBeNull();
    expect(screen.queryByRole("button", { name: "删除 Loop" })).toBeNull();
  });

  it("archives a Space definition after confirmation and returns to the Loop library", async () => {
    const user = userEvent.setup();
    const api = { mutate: vi.fn().mockResolvedValue({ status: "archived" }) };
    render(<LoopDefinitionLifecycle
      definitionId="loop/space 1"
      draftRevision={3}
      origin="space"
      status="published"
      lifecycle={lifecycle}
      api={api}
    />);

    await user.click(screen.getByRole("button", { name: "归档 Loop" }));
    expect(api.mutate).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "确认归档" }));

    await waitFor(() => expect(api.mutate).toHaveBeenCalledWith("archive"));
    expect(push).toHaveBeenCalledWith("/loops");
  });

  it("only offers physical deletion when the lifecycle has no references", () => {
    const api = { mutate: vi.fn() };
    const { rerender } = render(<LoopDefinitionLifecycle
      definitionId="loop_space"
      draftRevision={1}
      origin="space"
      status="draft"
      lifecycle={lifecycle}
      api={api}
    />);

    expect(screen.queryByRole("button", { name: "删除 Loop" })).toBeNull();

    rerender(<LoopDefinitionLifecycle
      definitionId="loop_space"
      draftRevision={1}
      origin="space"
      status="draft"
      lifecycle={{
        canArchive: true,
        canDelete: true,
        referenceCount: 0,
        references: { versions: 0, bindings: 0, runs: 0, receipts: 0, grants: 0 },
      }}
      api={api}
    />);

    expect(screen.getByRole("button", { name: "删除 Loop" })).toBeTruthy();
  });

  it("preserves actionable server errors", async () => {
    const user = userEvent.setup();
    const api = { mutate: vi.fn().mockRejectedValue(new Error("Loop 已被其他成员更新，请刷新后重试")) };
    render(<LoopDefinitionLifecycle
      definitionId="loop_space"
      draftRevision={3}
      origin="space"
      status="published"
      lifecycle={lifecycle}
      api={api}
    />);

    await user.click(screen.getByRole("button", { name: "归档 Loop" }));
    await user.click(screen.getByRole("button", { name: "确认归档" }));

    expect((await screen.findByRole("alert")).textContent).toContain("Loop 已被其他成员更新，请刷新后重试");
    expect(push).not.toHaveBeenCalled();
  });
});

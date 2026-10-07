// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ProjectLifecyclePanel } from "./project-lifecycle-panel";

afterEach(() => {
  cleanup();
  refresh.mockReset();
});

describe("ProjectLifecyclePanel", () => {
  it("completes a project directly when every milestone is done", async () => {
    const change = vi.fn().mockResolvedValue({});
    render(<ProjectLifecyclePanel
      projectId="project_1"
      status="active"
      version={7}
      canManage
      openMilestoneCount={0}
      api={{ change }}
    />);

    fireEvent.click(screen.getByRole("button", { name: /完成项目/u }));
    fireEvent.click(await screen.findByRole("button", { name: "确认完成" }));

    await waitFor(() => expect(change).toHaveBeenCalledWith({
      command: "complete",
      expectedVersion: 7,
    }));
    expect(refresh).toHaveBeenCalled();
  });

  it("requires a written reason before forcing past open milestones", async () => {
    const change = vi.fn().mockResolvedValue({});
    render(<ProjectLifecyclePanel
      projectId="project_1"
      status="draft"
      version={41}
      canManage
      openMilestoneCount={3}
      api={{ change }}
    />);

    fireEvent.click(screen.getByRole("button", { name: /完成项目/u }));
    const confirm = await screen.findByRole("button", { name: "确认完成" });
    // The reason is the audit trail for closing with open work, so it must not
    // be possible to submit without it.
    expect(confirm.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("强制完成原因"), { target: { value: "剩余范围转入后续项目" } });
    fireEvent.click(confirm);

    await waitFor(() => expect(change).toHaveBeenCalledWith({
      command: "complete",
      expectedVersion: 41,
      force: true,
      reason: "剩余范围转入后续项目",
    }));
  });

  it("offers archiving only after the project reached a terminal state", () => {
    render(<ProjectLifecyclePanel
      projectId="project_1"
      status="completed"
      version={9}
      canManage
      openMilestoneCount={0}
      api={{ change: vi.fn() }}
    />);

    expect(screen.getByRole("button", { name: /归档项目/u })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /完成项目/u })).toBeNull();
  });

  it("hides lifecycle controls from members who cannot manage them", () => {
    render(<ProjectLifecyclePanel
      projectId="project_1"
      status="active"
      version={1}
      canManage={false}
      openMilestoneCount={0}
      api={{ change: vi.fn() }}
    />);

    expect(screen.queryByRole("button", { name: /完成项目/u })).toBeNull();
    expect(screen.queryByRole("button", { name: /归档项目/u })).toBeNull();
  });

  it("keeps a completed project from being completed twice", () => {
    render(<ProjectLifecyclePanel
      projectId="project_1"
      status="completed"
      version={9}
      canManage
      openMilestoneCount={0}
      api={{ change: vi.fn() }}
    />);

    expect(screen.queryByRole("button", { name: /完成项目/u })).toBeNull();
  });
});

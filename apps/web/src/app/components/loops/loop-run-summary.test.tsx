// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoopRunSummary } from "./loop-run-summary";

describe("LoopRunSummary", () => {
  it("links a pending interaction to the canonical workspace", () => {
    render(<LoopRunSummary loopRun={{ id: "run_1", status: "waiting", currentNodeLabel: "需求确认", pendingInteraction: { id: "interaction_1", status: "open" } }} />);
    expect(screen.getByText("等待中 · 需求确认")).toBeTruthy();
    expect(screen.getByRole("link", { name: "打开 Loop 运行工作区" }).getAttribute("href")).toBe("/loop-runs/run_1?interaction=interaction_1");
  });
});

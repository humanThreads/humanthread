// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LoopTimeline } from "./loop-timeline";

describe("LoopTimeline", () => {
  it("renders a chronological interaction feed and pending slot", () => {
    render(<LoopTimeline items={[{
      id: "message_1",
      kind: "requirement_message",
      occurredAt: "2026-08-05T10:00:00.000Z",
      summary: "请确认单项目",
      actorType: "agent",
      actorId: "agent_1",
      status: "open",
    }]} currentInteraction={{ id: "interaction_1", status: "open" }} />);
    expect(screen.getByLabelText("工作流时间线")).toBeTruthy();
    expect(screen.getByTestId("timeline-item").textContent).toContain("请确认单项目");
    expect(screen.getByText("等待需求确认")).toBeTruthy();
  });
});

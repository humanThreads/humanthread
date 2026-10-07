// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PublicDeliveryDemo } from "./public-delivery-demo";

const revert = vi.hoisted(() => vi.fn());
const animate = vi.hoisted(() => vi.fn(() => ({ revert })));

vi.mock("animejs", () => ({ animate }));

const stages = [
  { key: "context", label: "项目上下文", detail: "准备依据" },
  { key: "assigned", label: "任务已派发", detail: "明确目标" },
  { key: "running", label: "Agent / Loop 执行", detail: "执行回传" },
  { key: "approval", label: "人工确认", detail: "等待判断" },
  { key: "recorded", label: "结果回写", detail: "保留记录" },
] as const;

describe("PublicDeliveryDemo", () => {
  beforeEach(() => {
    animate.mockClear();
    revert.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("plays one bounded delivery sequence while keeping every stage readable", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
      })),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const stageKey = this.parentElement?.getAttribute("data-delivery-stage");
        const index = stages.findIndex((stage) => stage.key === stageKey);
        const offset = Math.max(0, index) * 80;
        return {
          x: offset,
          y: 0,
          left: offset,
          top: 0,
          right: offset + 12,
          bottom: 12,
          width: 12,
          height: 12,
          toJSON: () => ({}),
        };
      },
    );

    const { container, unmount } = render(
      <PublicDeliveryDemo stages={stages} />,
    );

    expect(screen.getByRole("region", { name: "交付线程演示" })).toBeTruthy();
    expect(screen.getByText("Agent / Loop 执行")).toBeTruthy();
    expect(container.querySelectorAll("[data-delivery-node]")).toHaveLength(5);
    expect(container.querySelectorAll("[data-delivery-segment]")).toHaveLength(4);
    expect(screen.getByRole("button", { name: "重播交付演示" })).toBeTruthy();
    expect(animate).toHaveBeenCalled();
    const animationCalls = animate.mock.calls as unknown as Array<
      [unknown, Record<string, unknown>]
    >;
    const cursorAnimation = animationCalls.find(
      ([target]) =>
        target instanceof HTMLElement && target.hasAttribute("data-delivery-cursor"),
    );
    expect(cursorAnimation?.[1]).toMatchObject({ translateX: [0, 320] });
    const progressAnimation = animationCalls.find(
      ([target]) =>
        target instanceof HTMLElement && target.hasAttribute("data-delivery-progress"),
    );
    expect(progressAnimation?.[1]).toMatchObject({ scaleX: [0, 1] });

    fireEvent.click(screen.getByRole("button", { name: "重播交付演示" }));
    expect(animate.mock.calls.length).toBeGreaterThan(3);

    unmount();
    expect(revert).toHaveBeenCalled();
  });

  it("measures the compact cursor path between the first and last nodes", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(max-width: 767px)",
        media: query,
      })),
    );
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      function (this: HTMLElement) {
        const stageKey = this.parentElement?.getAttribute("data-delivery-stage");
        const index = stages.findIndex((stage) => stage.key === stageKey);
        const offset = Math.max(0, index) * 60;
        return {
          x: 0,
          y: offset,
          left: 0,
          top: offset,
          right: 12,
          bottom: offset + 12,
          width: 12,
          height: 12,
          toJSON: () => ({}),
        };
      },
    );

    render(<PublicDeliveryDemo stages={stages} />);

    const animationCalls = animate.mock.calls as unknown as Array<
      [unknown, Record<string, unknown>]
    >;
    const cursorAnimation = animationCalls.find(
      ([target]) =>
        target instanceof HTMLElement && target.hasAttribute("data-delivery-cursor"),
    );
    expect(cursorAnimation?.[1]).toMatchObject({ translateY: [0, 240] });
  });

  it("renders the complete static route when reduced motion is requested", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
      })),
    );

    const { container } = render(<PublicDeliveryDemo stages={stages} />);

    expect(container.querySelectorAll("[data-delivery-node]")).toHaveLength(5);
    expect(screen.getAllByText("结果回写")).toHaveLength(2);
    expect(animate).not.toHaveBeenCalled();
    expect(
      (container.querySelector("[data-delivery-cursor]") as HTMLElement).style.opacity,
    ).toBe("0");
    expect(
      (container.querySelector("[data-delivery-progress]") as HTMLElement).style.transform,
    ).toBe("scaleX(1)");
  });

  it("plays a user-requested replay even when automatic motion is reduced", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: query === "(prefers-reduced-motion: reduce)",
        media: query,
      })),
    );

    render(<PublicDeliveryDemo stages={stages} />);

    expect(animate).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("结果回写");

    fireEvent.click(screen.getByRole("button", { name: "重播交付演示" }));

    expect(animate).toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("项目上下文");

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(screen.getByRole("status").textContent).toContain("任务已派发");
  });
});

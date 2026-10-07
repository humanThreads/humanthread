// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MotionReveal } from "./motion-reveal";

const animate = vi.hoisted(() => vi.fn());

vi.mock("animejs", () => ({ animate }));

describe("MotionReveal", () => {
  it("renders its content with a stable key", () => {
    render(<MotionReveal motionKey="dashboard:personal">ready</MotionReveal>);

    expect(document.querySelector("[data-motion-key]")?.getAttribute(
      "data-motion-key",
    )).toBe("dashboard:personal");
  });

  it("does not animate when reduced motion is requested", () => {
    animate.mockClear();
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({ matches: true }),
    );

    render(<MotionReveal motionKey="reports:30d">report</MotionReveal>);

    expect(animate).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

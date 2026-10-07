// @vitest-environment jsdom

import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PublicDeliveryDemo } from "./public-delivery-demo";

const stages = [
  { key: "context", label: "项目上下文", detail: "准备依据" },
  { key: "assigned", label: "任务已派发", detail: "明确目标" },
  { key: "running", label: "Agent / Loop 执行", detail: "执行回传" },
  { key: "approval", label: "人工确认", detail: "等待判断" },
  { key: "recorded", label: "结果回写", detail: "保留记录" },
] as const;

describe("PublicDeliveryDemo real animation", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("moves the progress indicator away from its static completed state", async () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
      })),
    );

    const { container } = render(<PublicDeliveryDemo stages={stages} />);
    const progress = container.querySelector<HTMLElement>("[data-delivery-progress]");

    await waitFor(() => {
      expect(progress?.style.transform).not.toBe("scaleX(1)");
    });
  });
});

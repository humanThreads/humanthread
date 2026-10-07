import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TrendChart, trendBarHeight } from "./trend-chart";

describe("trendBarHeight", () => {
  it("normalizes values to the chart scale and clamps outliers", () => {
    expect(trendBarHeight(50, 100)).toBe("50%");
    expect(trendBarHeight(120, 100)).toBe("100%");
    expect(trendBarHeight(0, 0)).toBe("0%");
  });
});

describe("TrendChart", () => {
  it("keeps every bar within the chart height", () => {
    render(<TrendChart points={[
      { label: "第 1 周", completed: 1000, blockers: 400 },
      { label: "第 2 周", completed: 12, blockers: 0 },
    ]} />);

    expect(screen.getByLabelText("第 1 周完成 1000")).toHaveStyle({ height: "100%" });
    expect(screen.getByLabelText("第 1 周阻塞 400")).toHaveStyle({ height: "40%" });
  });
});

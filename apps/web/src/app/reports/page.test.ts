import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dynamic } from "./page";
import { normalizeDeliveryHealthRange } from "../../lib/workbench/workbench-delivery-health-report";
import { WORKBENCH_NAV_ITEMS } from "../components/workbench-nav";

describe("Reports page", () => {
  it("is dynamic and registered in navigation", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(WORKBENCH_NAV_ITEMS.find((item) => item.key === "reports")?.href).toBe("/reports");
  });

  it("defaults report ranges to 30 days", () => {
    expect(normalizeDeliveryHealthRange(undefined)).toBe("30d");
    expect(normalizeDeliveryHealthRange("7d")).toBe("7d");
  });

  it("does not source reports from dashboard collections", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("getWorkbenchDashboardData");
    expect(source).not.toContain("buildTaskReportMetrics");
    expect(source).toContain("getDeliveryHealthReport");
  });

  it("passes the selected Space key through report drilldowns", () => {
    const source = readFileSync(new URL("./page.tsx", import.meta.url), "utf8");
    expect(source).toContain("spaceKey: selected.key");
    expect(source).toContain("selectedSpaceKey={selected.key}");
  });
});

import { describe, expect, it } from "vitest";
import { buildDeliveryHealthTaskHref } from "./delivery-health-report";

describe("DeliveryHealthReport", () => {
  it("preserves Space and project scope in Task drilldowns", () => {
    expect(buildDeliveryHealthTaskHref({
      spaceKey: "company:1",
      projectId: "project 1",
      relation: "blocked",
    })).toBe("/tasks?spaceKey=company%3A1&project=project+1&relation=blocked");
  });
});

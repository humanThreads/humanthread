import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardActionBand } from "./dashboard-action-band";

describe("DashboardActionBand", () => {
  it("renders all action signals as stable drilldown links", () => {
    const markup = renderToStaticMarkup(<DashboardActionBand motionKey="personal:all" signals={[
      { key: "assigned", label: "待我处理", count: 2, description: "待推进", href: "/tasks?relation=assigned" },
      { key: "blocked", label: "已阻塞", count: 1, description: "待解除", href: "/tasks?relation=blocked" },
      { key: "acceptance", label: "待验收", count: 3, description: "待验收", href: "/tasks?status=in_review" },
      { key: "confirmation", label: "待确认", count: 4, description: "待审批", href: "/agents#approvals" },
    ]} />);

    expect(markup.match(/<a /gu)).toHaveLength(4);
    expect(markup).toContain("relation=blocked");
    expect(markup).toContain("待确认");
  });
});

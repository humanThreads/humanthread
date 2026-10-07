import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DashboardDecisionPanel } from "./dashboard-decision-panel";

describe("DashboardDecisionPanel", () => {
  it("keeps an explicit Task Center action when no task is selected", () => {
    const markup = renderToStaticMarkup(<DashboardDecisionPanel detail={null} pendingConfirmations={0} />);

    expect(markup).toContain("当前没有打开任务");
    expect(markup).toContain('href="/tasks"');
  });
});

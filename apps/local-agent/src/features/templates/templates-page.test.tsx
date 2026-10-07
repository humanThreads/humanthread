import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { DevelopmentTemplateItem } from "./development-template-queries";
import { TemplatesView } from "./templates-page";

const template: DevelopmentTemplateItem = {
  id: "template_1",
  name: "标准功能开发 Loop",
  kind: "development",
  version: 2,
  status: "published",
  origin: "space",
  spaceId: "space:personal:user_1",
  description: "覆盖需求确认、开发、测试和验收。",
  revision: 3,
  createdByUserId: "user_1",
  isPublic: true,
  industryTags: ["信息技术"],
  starCount: 12,
};

function view() {
  return <TemplatesView
    busy={false}
    customTemplates={[template]}
    marketTemplates={[template]}
    onCopy={vi.fn()}
    onCreate={vi.fn().mockResolvedValue(undefined)}
    onDelete={vi.fn()}
    onRename={vi.fn()}
    onSortChange={vi.fn()}
    onStar={vi.fn()}
    onTabChange={vi.fn()}
    onViewChange={vi.fn()}
    onVisibilityChange={vi.fn()}
    sort="published"
    starredTemplateIds={[]}
    tab="market"
    view="card"
    writeEnabled
  />;
}

describe("Loop template library", () => {
  it("defaults to the official Loop market and renders a multi-column card grid", () => {
    render(view());
    expect(screen.getByRole("tab", { name: "Loop 市场" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByText("标准功能开发 Loop")).toBeInTheDocument();
    expect(screen.getByTestId("template-card-grid")).toHaveAttribute("data-columns", "multi");
    expect(screen.getByRole("navigation", { name: "Loop 市场分页" })).toBeInTheDocument();
  });

  it("supports star and copy actions from the market", async () => {
    const user = userEvent.setup();
    const onStar = vi.fn();
    const onCopy = vi.fn();
    render(<TemplatesView
      busy={false}
      customTemplates={[]}
      marketTemplates={[template]}
      onCopy={onCopy}
      onCreate={vi.fn().mockResolvedValue(undefined)}
      onDelete={vi.fn()}
      onRename={vi.fn()}
      onSortChange={vi.fn()}
      onStar={onStar}
      onTabChange={vi.fn()}
      onViewChange={vi.fn()}
      onVisibilityChange={vi.fn()}
      sort="published"
      starredTemplateIds={[]}
      tab="market"
      view="card"
      writeEnabled
    />);
    await user.click(screen.getByRole("button", { name: /星标/u }));
    await user.click(screen.getByRole("button", { name: "复制到我的模版" }));
    expect(onStar).toHaveBeenCalledWith(template);
    expect(onCopy).toHaveBeenCalledWith(template);
  });
});

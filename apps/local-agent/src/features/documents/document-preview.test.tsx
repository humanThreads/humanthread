import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { DocumentPreview } from "./document-preview";

describe("DocumentPreview", () => {
  it("renders GFM in an independently scrollable safe preview", () => {
    render(<DocumentPreview markdown={[
      "# 发布清单",
      "",
      "| 项目 | 状态 |",
      "| --- | --- |",
      "| Desktop | 完成 |",
      "",
      "<script>alert('unsafe')</script>",
      "",
      "[外部说明](https://example.com/docs)",
    ].join("\n")} />);

    expect(screen.getByTestId("document-preview")).toHaveClass("document-preview-scroll");
    expect(screen.getByRole("table")).toBeVisible();
    expect(screen.getByText("<script>alert('unsafe')</script>")).toBeVisible();
    expect(screen.queryByText("unsafe", { selector: "script" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "外部说明" })).toHaveAttribute("target", "_blank");
    expect(screen.getByRole("link", { name: "外部说明" })).toHaveAttribute(
      "rel",
      "noreferrer noopener",
    );
  });
});

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PreviewSessionProvider } from "../session/preview-session";
import { DesktopShell } from "./desktop-shell";

function renderShell() {
  localStorage.clear();
  return render(
    <MemoryRouter>
      <PreviewSessionProvider storage={localStorage}>
        <DesktopShell activeKey="dashboard">
          <div>工作台内容</div>
        </DesktopShell>
      </PreviewSessionProvider>
    </MemoryRouter>,
  );
}

describe("DesktopShell", () => {
  it("collapses and restores the light navigation without losing the active page", async () => {
    const user = userEvent.setup();
    renderShell();

    expect(screen.getByText("工作台内容")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "收起主导航" }));
    expect(screen.getByRole("navigation", { name: "主导航" })).toHaveAttribute(
      "data-collapsed",
      "true",
    );
    await user.click(screen.getByRole("button", { name: "展开主导航" }));
    expect(screen.getByRole("navigation", { name: "主导航" })).toHaveAttribute(
      "data-collapsed",
      "false",
    );
  });

  it("shows the read-only execution state and current space", () => {
    renderShell();
    expect(screen.getByText("只读预览")).toBeInTheDocument();
    expect(screen.getByLabelText("当前空间")).toBeInTheDocument();
  });
});

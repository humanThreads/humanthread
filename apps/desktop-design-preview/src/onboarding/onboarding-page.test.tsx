import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { PreviewSessionProvider } from "../session/preview-session";
import { OnboardingPage } from "./onboarding-page";

function renderOnboarding() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter initialEntries={["/onboarding"]}>
      <PreviewSessionProvider storage={localStorage}>
        <QueryClientProvider client={queryClient}>
          <OnboardingPage storage={localStorage} />
        </QueryClientProvider>
      </PreviewSessionProvider>
    </MemoryRouter>,
  );
}

describe("OnboardingPage", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("requires confirmation before enabling task claiming and never completes without execution evidence", async () => {
    const user = userEvent.setup();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    renderOnboarding();

    await user.click(screen.getByRole("button", { name: "进入第 6 步" }));
    await user.click(screen.getByRole("checkbox", { name: "允许领取真实任务" }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(screen.getByText("真实执行已开启，但本机桥接未连接")).toBeInTheDocument();
    expect(screen.queryByText("开箱向导已完成")).not.toBeInTheDocument();
  });

  it("blocks the final claim check instead of fabricating successful execution", async () => {
    const user = userEvent.setup();
    renderOnboarding();
    await user.click(screen.getByRole("button", { name: "进入第 8 步" }));
    await user.click(screen.getByRole("button", { name: "执行无副作用检查" }));

    expect(screen.getByText("未领取任务，未产生执行证据")).toBeInTheDocument();
    expect(
      within(screen.getByRole("complementary", { name: "步骤证据" })).getByText("阻塞"),
    ).toBeInTheDocument();
  });
});

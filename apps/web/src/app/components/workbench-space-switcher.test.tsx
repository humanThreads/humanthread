// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkbenchSpaceSwitcher } from "./workbench-space-switcher";

const { push, refresh } = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, refresh }),
}));

afterEach(() => {
  cleanup();
  push.mockReset();
  refresh.mockReset();
});

const SPACE_FILTERS = [
  { key: "all", label: "全部", companyId: null, ownerType: null },
  { key: "personal", label: "个人空间", companyId: null, ownerType: "personal" as const },
  { key: "company_1", label: "HumanThread", companyId: "company_1", ownerType: "company" as const, role: "owner" as const },
];

describe("WorkbenchSpaceSwitcher", () => {
  it("separates aggregate, personal, and company spaces with a selected state", async () => {
    const user = userEvent.setup();
    render(
      <WorkbenchSpaceSwitcher
        selectedSpaceKey="company_1"
        spaceFilters={SPACE_FILTERS}
        action={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    await user.click(screen.getByRole("button", { name: "切换工作空间，当前为 HumanThread" }));

    expect(screen.getByRole("menuitemradio", { name: "全部工作空间" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("menuitemradio", { name: "个人空间" }).getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("menuitemradio", { name: "HumanThread，公司空间，当前角色 owner" }).getAttribute("aria-checked")).toBe("true");
  });

  it("closes and refreshes the current route after a successful switch", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WorkbenchSpaceSwitcher
        selectedSpaceKey="company_1"
        spaceFilters={SPACE_FILTERS}
        action={action}
      />,
    );

    await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "个人空间" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    const submitted = action.mock.calls[0]?.[0] as FormData;
    expect(submitted.get("spaceKey")).toBe("personal");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("leaves a document detail route for the selected document workspace", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WorkbenchSpaceSwitcher
        selectedSpaceKey="company_1"
        spaceFilters={SPACE_FILTERS}
        spaceSwitchPath="/documents"
        action={action}
      />,
    );

    await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "个人空间" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/documents?space=personal"));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the menu open and supports retry after a failed switch", async () => {
    const user = userEvent.setup();
    const action = vi.fn()
      .mockResolvedValueOnce({ ok: false, error: "该工作空间不可用，请刷新后重试" })
      .mockResolvedValueOnce({ ok: true });
    render(
      <WorkbenchSpaceSwitcher
        selectedSpaceKey="company_1"
        spaceFilters={SPACE_FILTERS}
        action={action}
      />,
    );

    await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "个人空间" }));

    expect((await screen.findByRole("alert")).textContent).toContain("该工作空间不可用，请刷新后重试");
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull());
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "HumanThread，公司空间，当前角色 owner" }).getAttribute("aria-checked")).toBe("true");

    await user.click(screen.getByRole("menuitemradio", { name: "个人空间" }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1), { timeout: 10_000 });
    expect(action).toHaveBeenCalledTimes(2);
  }, 30_000);

  it("closes without mutation when the active space is selected", async () => {
    const user = userEvent.setup();
    const action = vi.fn().mockResolvedValue({ ok: true });
    render(
      <WorkbenchSpaceSwitcher
        selectedSpaceKey="company_1"
        spaceFilters={SPACE_FILTERS}
        action={action}
      />,
    );

    await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "HumanThread，公司空间，当前角色 owner" }));

    expect(action).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("locks duplicate selection while the action is pending", async () => {
    const user = userEvent.setup();
    let resolveAction: ((value: { ok: true }) => void) | undefined;
    const action = vi.fn(() => new Promise<{ ok: true }>((resolve) => {
      resolveAction = resolve;
    }));
    render(
      <WorkbenchSpaceSwitcher
        selectedSpaceKey="company_1"
        spaceFilters={SPACE_FILTERS}
        action={action}
      />,
    );

    await user.click(screen.getByRole("button", { name: /切换工作空间/ }));
    await user.click(screen.getByRole("menuitemradio", { name: "个人空间" }));

    expect(await screen.findByText("正在切换工作空间...")).toBeTruthy();
    expect(screen.getByRole("menuitemradio", { name: "全部工作空间" }).hasAttribute("data-disabled")).toBe(true);
    resolveAction?.({ ok: true });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("restores trigger focus after Escape and constrains long lists", async () => {
    const user = userEvent.setup();
    const manySpaces = [
      ...SPACE_FILTERS,
      ...Array.from({ length: 12 }, (_, index) => ({
        key: `company_${index + 2}`,
        label: `Company ${index + 2}`,
        companyId: `company_${index + 2}`,
        ownerType: "company" as const,
        role: "member" as const,
      })),
    ];
    render(
      <WorkbenchSpaceSwitcher
        selectedSpaceKey="company_1"
        spaceFilters={manySpaces}
        action={vi.fn().mockResolvedValue({ ok: true })}
      />,
    );

    const trigger = screen.getByRole("button", { name: /切换工作空间/ });
    await user.click(trigger);
    expect(screen.getByTestId("workbench-space-options").className).toContain("overflow-y-auto");
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
});

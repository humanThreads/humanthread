import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { GlobalSearch } from "./global-search";

describe("desktop global search", () => {
  it("debounces the query and exposes authorized result routes", async () => {
    const user = userEvent.setup();
    const search = vi.fn().mockResolvedValue({
      query: "desktop",
      tasks: [{
        id: "task_1",
        title: "重构桌面客户端",
        subtitle: "HumanThread · Owner",
        status: "doing",
        updatedAt: "2026-07-27T08:00:00.000Z",
        route: "/tasks/task_1",
      }],
      projects: [],
      documents: [],
      members: [],
      agents: [],
    });
    render(
      <MemoryRouter>
        <GlobalSearch contextKey="session_1:personal" onClose={() => {}} search={search} />
      </MemoryRouter>,
    );

    await user.type(screen.getByRole("searchbox"), "desktop");

    expect(await screen.findByText("重构桌面客户端")).toBeVisible();
    expect(screen.getByRole("link", { name: /重构桌面客户端/ }))
      .toHaveAttribute("href", "/tasks/task_1");
    expect(search).toHaveBeenCalledTimes(1);
  });
});

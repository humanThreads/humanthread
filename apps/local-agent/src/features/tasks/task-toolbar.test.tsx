import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskToolbar } from "./task-toolbar";

describe("desktop Task toolbar", () => {
  it("switches views and exposes relation counts", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TaskToolbar
        onChange={onChange}
        query={{
          view: "board",
          relation: "assigned",
          search: "",
          status: [],
          group: "status",
        sort: "updated_desc",
        page: 1,
        pageSize: 20,
        }}
        relationCounts={{ assigned: 3 }}
        savedViews={[]}
        total={3}
        writeEnabled
      />,
    );

    expect(screen.getByRole("tab", { name: "看板" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("button", { name: /分配给我 3/ })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("tab", { name: "日历" }));
    expect(onChange).toHaveBeenCalledWith({ view: "calendar" });
  });
});

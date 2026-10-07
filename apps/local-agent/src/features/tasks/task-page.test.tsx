import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TaskWorkspace } from "./task-page";
import { collectionFixture } from "./task-test-fixtures";

describe("desktop Task workspace", () => {
  it("renders the selected collection view and selection summary", () => {
    render(
      <MemoryRouter>
        <TaskWorkspace
          collection={collectionFixture}
          onQueryChange={vi.fn()}
          onSaveView={vi.fn()}
          onPageChange={vi.fn()}
          onPageSizeChange={vi.fn()}
          query={{
            view: "list",
            relation: "all",
            search: "",
            status: [],
            group: "status",
            sort: "updated_desc",
            page: 1,
            pageSize: 20,
          }}
          runTaskCommand={vi.fn()}
          savedViews={[]}
          writeEnabled
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("table", { name: "任务列表" })).toBeVisible();
    expect(screen.getByText("1 个任务")).toBeVisible();
  });

  it("uses server pagination controls while keeping the current filters", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    render(
      <MemoryRouter>
        <TaskWorkspace
          collection={{
            ...collectionFixture,
            page: 1,
            pageSize: 20,
            hasNextPage: true,
            hasPreviousPage: false,
            total: 45,
          }}
          onPageChange={onPageChange}
          onPageSizeChange={vi.fn()}
          onQueryChange={vi.fn()}
          onSaveView={vi.fn()}
          query={{
            view: "list",
            relation: "assigned",
            search: "desktop",
            status: [],
            group: "status",
            sort: "updated_desc",
            page: 1,
            pageSize: 20,
          }}
          runTaskCommand={vi.fn()}
          savedViews={[]}
          writeEnabled
        />
      </MemoryRouter>,
    );

    expect(screen.getByText("1-20 / 共 45 条")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "任务列表下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });
});

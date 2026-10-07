import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskPagination } from "./task-pagination";

describe("TaskPagination", () => {
  it("shows total range and changes page and page size", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();
    const onPageSizeChange = vi.fn();
    render(
      <TaskPagination
        hasNextPage
        hasPreviousPage
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
        page={2}
        pageSize={20}
        total={45}
      />,
    );

    expect(screen.getByText("21-40 / 共 45 条")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "任务列表下一页" }));
    expect(onPageChange).toHaveBeenCalledWith(3);
    await user.selectOptions(screen.getByLabelText("任务每页条数"), "50");
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });
});

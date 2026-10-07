import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TaskList, TASK_LIST_COLUMNS } from "./task-list";
import { taskFixture } from "./task-test-fixtures";

describe("desktop Task list", () => {
  it("renders user-facing columns and supports selection", async () => {
    const user = userEvent.setup();
    const onSelectionChange = vi.fn();
    render(
      <MemoryRouter>
        <TaskList
          onSelectionChange={onSelectionChange}
          selectedTaskIds={[]}
          tasks={[taskFixture]}
        />
      </MemoryRouter>,
    );

    expect(TASK_LIST_COLUMNS).toEqual([
      "任务", "状态", "负责人", "优先级", "截止时间", "项目", "子任务",
    ]);
    expect(screen.getAllByRole("link", { name: taskFixture.title })[0]).toHaveAttribute(
      "href",
      `/tasks/${taskFixture.id}`,
    );
    await user.click(screen.getAllByRole("checkbox", { name: `选择${taskFixture.title}` })[0]!);
    expect(onSelectionChange).toHaveBeenCalledWith([taskFixture.id]);
  });
});

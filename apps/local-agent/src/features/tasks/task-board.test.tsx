import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { TaskBoard } from "./task-board";
import { taskFixture } from "./task-test-fixtures";

describe("desktop Task board", () => {
  it("runs a versioned status transition from a stable status column", async () => {
    const user = userEvent.setup();
    const runTaskCommand = vi.fn().mockResolvedValue(undefined);
    render(
      <MemoryRouter>
        <TaskBoard
          group="status"
          runTaskCommand={runTaskCommand}
          tasks={[taskFixture]}
          writeEnabled
        />
      </MemoryRouter>,
    );

    expect(screen.getByRole("group", { name: "待处理" })).toHaveTextContent(taskFixture.title);
    await user.click(screen.getByRole("button", { name: "移动到 进行中" }));
    expect(runTaskCommand).toHaveBeenCalledWith(
      taskFixture.id,
      "start",
      expect.objectContaining({
        commandId: expect.stringMatching(/^desktop:task:/u),
        expectedVersion: taskFixture.version,
      }),
    );
  });

  it("disables write actions while revalidating", () => {
    render(
      <MemoryRouter>
        <TaskBoard group="status" runTaskCommand={vi.fn()} tasks={[taskFixture]} writeEnabled={false} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("button", { name: "移动到 进行中" })).toBeDisabled();
  });

  it("groups the same collection by assignee", () => {
    render(
      <MemoryRouter>
        <TaskBoard group="assignee" runTaskCommand={vi.fn()} tasks={[taskFixture]} writeEnabled />
      </MemoryRouter>,
    );

    expect(screen.getByRole("group", { name: "Owner" })).toHaveTextContent(taskFixture.title);
    expect(screen.queryByRole("group", { name: "待规划" })).not.toBeInTheDocument();
  });
});

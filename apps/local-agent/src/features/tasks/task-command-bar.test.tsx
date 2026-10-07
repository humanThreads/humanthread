import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TaskCommandBar } from "./task-command-bar";

describe("desktop Task command bar", () => {
  it("shows and runs status commands only when the server capability allows them", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn().mockResolvedValue(undefined);
    const { rerender } = render(
      <TaskCommandBar
        capabilities={{ changeStatus: false }}
        onCommand={onCommand}
        statusCategory="todo"
        version={3}
        writeEnabled
      />,
    );

    expect(screen.queryByRole("button", { name: "开始任务" })).not.toBeInTheDocument();

    rerender(
      <TaskCommandBar
        capabilities={{ changeStatus: true }}
        onCommand={onCommand}
        statusCategory="todo"
        version={3}
        writeEnabled
      />,
    );
    await user.click(screen.getByRole("button", { name: "开始任务" }));

    expect(onCommand).toHaveBeenCalledWith("start", expect.objectContaining({
      commandId: expect.stringMatching(/^desktop:task:/u),
      expectedVersion: 3,
    }));
  });
});

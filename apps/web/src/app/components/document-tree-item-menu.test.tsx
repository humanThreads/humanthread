// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentTreeItemMenu } from "./document-tree-item-menu";

afterEach(cleanup);

describe("DocumentTreeItemMenu", () => {
  it("opens a complete keyboard-accessible command menu", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    const trigger = render(
      <DocumentTreeItemMenu
        item={{ id: "dir_1", label: "产品设计" }}
        commands={[
          { command: { type: "rename-directory", groupKey: "space:space_1", directoryId: "dir_1" }, label: "重命名" },
          { command: { type: "delete-directory", groupKey: "space:space_1", directoryId: "dir_1" }, label: "删除空文件夹", destructive: true },
        ]}
        onCommand={onCommand}
      />,
    ).getByRole("button", { name: "产品设计的更多操作" });

    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "重命名" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "删除空文件夹" }).className).toContain("text-[#cf222e]");
    await user.click(screen.getByRole("menuitem", { name: "重命名" }));
    expect(onCommand).toHaveBeenCalledWith({ type: "rename-directory", groupKey: "space:space_1", directoryId: "dir_1" });
  });

  it("keeps the touch trigger visible and disables unavailable commands", async () => {
    const user = userEvent.setup();
    const onCommand = vi.fn();
    render(
      <DocumentTreeItemMenu
        item={{ id: "doc_1", label: "说明" }}
        commands={[{
          command: { type: "reorder-document", groupKey: "space:space_1", documentId: "doc_1", direction: "up" },
          label: "上移",
          disabled: true,
        }]}
        onCommand={onCommand}
      />,
    );

    const trigger = screen.getByRole("button", { name: "说明的更多操作" });
    expect(trigger.className).toContain("md:opacity-0");
    await user.click(trigger);
    expect(screen.getByRole("menuitem", { name: "上移" }).hasAttribute("data-disabled")).toBe(true);
    await user.click(screen.getByRole("menuitem", { name: "上移" }));
    expect(onCommand).not.toHaveBeenCalled();
  });
});

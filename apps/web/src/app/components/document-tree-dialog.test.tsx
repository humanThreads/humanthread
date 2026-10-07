// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentTreeDialog } from "./document-tree-dialog";

afterEach(cleanup);

const tree = {
  spaceId: "space_1",
  groups: [{
    key: "space:space_1",
    label: "个人空间",
    spaceId: "space_1",
    projectId: null,
    canWrite: true,
    directories: [
      { id: "dir_parent", parentId: null, name: "产品设计", path: "产品设计", sortOrder: 0 },
      { id: "dir_child", parentId: "dir_parent", name: "评审", path: "产品设计/评审", sortOrder: 0 },
      { id: "dir_other", parentId: null, name: "发布", path: "发布", sortOrder: 1000 },
    ],
    documents: [],
  }],
  trash: [],
};

describe("DocumentTreeDialog", () => {
  it("labels a contextual modal dialog", () => {
    render(
      <DocumentTreeDialog
        command={{
          type: "create-directory",
          groupKey: "space:space_1",
          parentId: null,
        }}
        tree={tree}
        pending={false}
        error={null}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />,
    );

    expect(screen.getByRole("dialog", { name: "新建文件夹" })).toBeTruthy();
    expect(screen.getByText("个人空间 / 根目录")).toBeTruthy();
  });

  it("generates a filename until the user edits it", async () => {
    const user = userEvent.setup();
    render(
      <DocumentTreeDialog
        command={{ type: "create-document", groupKey: "space:space_1", directoryId: "dir_parent" }}
        tree={tree}
        pending={false}
        error={null}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />,
    );

    await user.type(screen.getByLabelText("文档标题"), "需求 评审记录");
    expect((screen.getByLabelText("文件名") as HTMLInputElement).value).toBe("需求-评审记录.md");
    expect(screen.getByText("产品设计/需求-评审记录.md")).toBeTruthy();

    await user.clear(screen.getByLabelText("文件名"));
    await user.type(screen.getByLabelText("文件名"), "custom.md");
    await user.type(screen.getByLabelText("文档标题"), "补充");
    expect((screen.getByLabelText("文件名") as HTMLInputElement).value).toBe("custom.md");
  });

  it("keeps invalid input and prevents submission", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <DocumentTreeDialog
        command={{ type: "create-directory", groupKey: "space:space_1", parentId: null }}
        tree={tree}
        pending={false}
        error={null}
        onClose={() => undefined}
        onSubmit={onSubmit}
      />,
    );

    await user.type(screen.getByLabelText("文件夹名称"), "docs/api");
    await user.click(screen.getByRole("button", { name: "创建文件夹" }));
    expect(screen.getByText("文件夹名称不能包含路径分隔符")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
    expect((screen.getByLabelText("文件夹名称") as HTMLInputElement).value).toBe("docs/api");
  });

  it("locks dismissal and duplicate submission while pending", () => {
    render(
      <DocumentTreeDialog
        command={{ type: "delete-directory", groupKey: "space:space_1", directoryId: "dir_other" }}
        tree={tree}
        pending
        error={null}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />,
    );

    expect(screen.getByRole("dialog").getAttribute("aria-busy")).toBe("true");
    expect((screen.getByRole("button", { name: "删除中" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "取消" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("reveals restore overrides when the original path conflicts", () => {
    render(
      <DocumentTreeDialog
        command={{ type: "restore-document", groupKey: "space:space_1", documentId: "doc_deleted" }}
        tree={{ ...tree, trash: [{ id: "doc_deleted", groupKey: "space:space_1", directoryId: null, title: "说明", path: ".trash/doc_deleted.md", sortOrder: 0, deletedAt: new Date() }] }}
        pending={false}
        error={{ message: "原位置已有同名文档，请选择新位置或修改文件名。", field: "filename", restoreConflict: true }}
        onClose={() => undefined}
        onSubmit={async () => undefined}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain("原位置已有同名文档");
    expect(screen.getByLabelText("恢复到")).toBeTruthy();
    expect((screen.getByLabelText("文件名") as HTMLInputElement).value).toBe("说明.md");
  });
});

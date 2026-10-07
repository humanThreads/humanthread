// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerImageCatalogForm } from "./worker-image-catalog-form";

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

afterEach(cleanup);

describe("WorkerImageCatalogForm", () => {
  it("提示镜像仓库地址最多 767 个字符", () => {
    render(<WorkerImageCatalogForm sources={[]} action={vi.fn()} />);

    expect(screen.getByLabelText("镜像仓库").getAttribute("maxLength")).toBe("767");
  });

  it("新增镜像来源后刷新服务端目录并保留新增版本入口", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({ ok: true });
    render(<WorkerImageCatalogForm sources={[]} action={save} />);

    await user.type(screen.getByLabelText("来源名称"), "公司标准 Worker");
    await user.type(screen.getByLabelText("镜像仓库"), "registry.example.com/company-worker");
    await user.click(screen.getByRole("button", { name: "新增镜像来源" }));

    expect(save).toHaveBeenCalledWith({
      kind: "source",
      name: "公司标准 Worker",
      repository: "registry.example.com/company-worker",
    });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("镜像来源已新增，可以继续新增版本。")).toBeTruthy();
  });

  it("通过来源和不可变 Digest 两级表单维护镜像目录", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({ ok: true });
    render(<WorkerImageCatalogForm sources={[{ id: "a".repeat(32), name: "正式 Worker", repository: "registry.example.com/worker", versions: [] }]} action={save} />);

    await user.selectOptions(screen.getByLabelText("镜像来源"), "a".repeat(32));
    await user.type(screen.getByLabelText("镜像 Tag"), "20260917-a");
    await user.type(screen.getByLabelText("镜像 Digest"), `sha256:${"b".repeat(64)}`);
    await user.click(screen.getByRole("button", { name: "新增镜像版本" }));

    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: "version", sourceId: "a".repeat(32), tag: "20260917-a" }));
  });

  it("按镜像来源筛选版本，并用表格和短按钮管理状态", async () => {
    const user = userEvent.setup();
    const save = vi.fn().mockResolvedValue({ ok: true });
    const activeVersionId = "b".repeat(32);
    const disabledVersionId = "c".repeat(32);
    const companyVersionId = "f".repeat(32);
    render(<WorkerImageCatalogForm sources={[
      {
        id: "a".repeat(32),
        name: "平台 Worker",
        repository: "registry.example.com/platform-worker",
        versions: [
          { id: activeVersionId, tag: "20260917-a", digest: `sha256:${"d".repeat(64)}`, status: "active" },
          { id: disabledVersionId, tag: "20260917-b", digest: `sha256:${"e".repeat(64)}`, status: "disabled" },
        ],
      },
      {
        id: "2".repeat(32),
        name: "公司 Worker",
        repository: "registry.example.com/company-worker",
        versions: [
          { id: companyVersionId, tag: "20260918-company", digest: `sha256:${"3".repeat(64)}`, status: "active" },
        ],
      },
    ]} action={save} />);

    expect(screen.getByText("20260917-a")).toBeTruthy();
    expect(screen.getByText("20260917-b")).toBeTruthy();
    expect(screen.getByText("20260918-company")).toBeTruthy();
    const table = screen.getByRole("table", { name: "镜像版本列表" });
    expect(within(table).getByText("来源")).toBeTruthy();
    expect(within(table).getByText("Tag")).toBeTruthy();
    expect(within(table).getByText("Digest")).toBeTruthy();
    expect(within(table).getByText("状态")).toBeTruthy();
    expect(within(table).getByText("操作")).toBeTruthy();

    await user.selectOptions(screen.getByLabelText("筛选镜像来源"), "a".repeat(32));
    expect(screen.getByText("20260917-a")).toBeTruthy();
    expect(screen.queryByText("20260918-company")).toBeNull();

    const activeRow = screen.getByText("20260917-a").closest("tr")!;
    await user.click(within(activeRow).getByRole("button", { name: "禁用" }));
    expect(save).toHaveBeenCalledWith({ kind: "version-status", versionId: activeVersionId, status: "disabled" });
    expect(await screen.findByText("镜像版本已禁用")).toBeTruthy();

    const disabledRow = screen.getByText("20260917-b").closest("tr")!;
    await user.click(within(disabledRow).getByRole("button", { name: "启用" }));
    expect(save).toHaveBeenCalledWith({ kind: "version-status", versionId: disabledVersionId, status: "active" });
    expect(await screen.findByText("镜像版本已启用")).toBeTruthy();
  });
});

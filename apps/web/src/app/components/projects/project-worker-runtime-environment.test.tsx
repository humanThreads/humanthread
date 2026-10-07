// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerRuntimeEnvironment } from "../../../lib/orchestration/worker-runtime-environment";
import { ProjectWorkerRuntimeEnvironment } from "./project-worker-runtime-environment";

afterEach(cleanup);

describe("ProjectWorkerRuntimeEnvironment", () => {
  it("可用常用环境快速填入并展示挂载根目录解析后的缓存路径", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() { const [value, setValue] = useState<WorkerRuntimeEnvironment | undefined>(undefined); return <ProjectWorkerRuntimeEnvironment value={value} onChange={(next) => { onChange(next); setValue(next); }} />; }
    render(<Harness />);

    await user.selectOptions(screen.getByLabelText("常用开发环境"), "node-pnpm");
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ profile: "node-pnpm" }));
    expect(document.body.textContent).toContain("PNPM_HOME=/var/lib/humanthread/pnpm");
    expect(document.body.textContent).toContain("npm_config_cache=/var/lib/humanthread/npm");
  });

  it("允许修改挂载根目录和新增自定义非敏感变量", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    function Harness() { const [value, setValue] = useState<WorkerRuntimeEnvironment>({ profile: "custom", mountPath: "/workspace", taskSubpath: "/tasks", variables: [] }); return <ProjectWorkerRuntimeEnvironment value={value} onChange={(next) => { onChange(next); setValue(next); }} />; }
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "新增运行变量" }));
    expect(screen.getByLabelText("运行变量名")).toBeTruthy();
    expect((screen.getByLabelText("挂载根目录") as HTMLInputElement).value).toBe("/workspace");
  });
});

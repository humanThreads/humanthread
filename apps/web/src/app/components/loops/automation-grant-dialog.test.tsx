// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AutomationGrantDialog } from "./automation-grant-dialog";

afterEach(cleanup);

describe("AutomationGrantDialog", () => {
  it("shows the Workspace boundary before workspace_full confirmation", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const project = {
      id: "project_1",
      name: "HumanThread",
      spaceId: "space_1",
      workspaceBindings: [{
        id: "workspace_1",
        deviceId: "device_1",
        deviceName: "Alice MacBook",
        status: "ready" as const,
        configurationVersion: 2,
      }],
    };
    render(<AutomationGrantDialog
      open
      project={project}
      bindings={[{
        id: "binding_1",
        label: "交付闭环 v3",
        grantScope: {
          nodeKeys: ["prepare_task_branch", "develop", "verify_and_push"],
          executionPlanes: ["local", "platform"],
          providers: [],
          tools: [],
          commandCategories: [],
          operationTypes: ["task_loop.invoke"],
          networkTargets: [],
          recipients: [],
          credentialRefs: [],
        },
      }]}
      agentProfileIds={["profile_codex"]}
      providers={["codex"]}
      onClose={() => undefined}
      onConfirm={onConfirm}
    />);

    await user.click(screen.getByLabelText("允许项目 Workspace 内自动修改"));

    expect(screen.getByText("Alice MacBook · 配置 v2")).toBeTruthy();
    expect(screen.getByDisplayValue(".")).toBeTruthy();
    expect(screen.getByText("不包含 Git 推送、外部收件人、生产系统和 Workspace 外路径")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "确认授权" }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      permission: "workspace_full",
      workspaceBindingIds: ["workspace_1"],
      allowedRelativePathPrefixes: ["."],
      deviceIds: ["device_1"],
      workerIds: ["local-worker:device_1"],
      agentProfileIds: ["profile_codex"],
      providers: ["codex"],
      nodeKeys: ["develop", "prepare_task_branch", "verify_and_push"],
      executionPlanes: ["local", "platform"],
      operationTypes: [
        "task_loop.invoke",
        "workspace.delete",
        "workspace.read",
        "workspace.write",
      ],
      policyVersion: "policy_v1",
    }));
    expect(JSON.stringify(onConfirm.mock.calls)).not.toContain("/work/");
  });

  it("creates a non-Workspace grant when every Workspace is unchecked", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    render(<AutomationGrantDialog
      open
      project={{
        id: "project_1",
        name: "HumanThread",
        spaceId: "space_1",
        workspaceBindings: [{
          id: "workspace_1",
          deviceId: "device_1",
          deviceName: "MacIntel - alpha",
          status: "ready",
          configurationVersion: 1,
        }],
      }}
      bindings={[{
        id: "binding_1",
        label: "交付闭环 v1",
        grantScope: {
          nodeKeys: ["develop"],
          executionPlanes: ["platform"],
          providers: [],
          tools: [],
          commandCategories: [],
          operationTypes: [],
          networkTargets: [],
          recipients: [],
          credentialRefs: [],
        },
      }]}
      agentProfileIds={["profile_codex"]}
      providers={["codex"]}
      onClose={() => undefined}
      onConfirm={onConfirm}
    />);

    await user.click(screen.getByLabelText("MacIntel - alpha"));
    await user.click(screen.getByRole("button", { name: "确认授权" }));

    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({
      permission: "none",
      workspaceBindingIds: [],
      allowedRelativePathPrefixes: [],
      deviceIds: [],
      workerIds: [],
      operationTypes: [],
      tools: [],
      commandCategories: [],
      nodeKeys: ["develop"],
      executionPlanes: ["platform"],
    }));
  });

  it("does not retain checkbox events across batched binding-scope updates", () => {
    render(<AutomationGrantDialog
      open
      project={{ id: "project_1", name: "HumanThread", spaceId: "space_1", workspaceBindings: [] }}
      bindings={[{
        id: "binding_1",
        label: "交付闭环 v1",
        grantScope: {
          nodeKeys: ["develop"],
          executionPlanes: ["platform"],
          providers: [],
          tools: [],
          commandCategories: [],
          operationTypes: [],
          networkTargets: [],
          recipients: [],
          credentialRefs: [],
        },
      }]}
      agentProfileIds={["profile_codex"]}
      providers={["codex"]}
      onClose={() => undefined}
      onConfirm={vi.fn()}
    />);
    const bindingCheckbox = screen.getByRole("checkbox", { name: "交付闭环 v1" }) as HTMLInputElement;

    expect(() => act(() => {
      bindingCheckbox.click();
      bindingCheckbox.click();
    })).not.toThrow();

    expect(bindingCheckbox.checked).toBe(true);
  });

  it("explains when the project or grant endpoint is missing", async () => {
    const user = userEvent.setup();
    render(<AutomationGrantDialog
      open
      project={{
        id: "project_1",
        name: "HumanThread",
        spaceId: "space_1",
        workspaceBindings: [],
      }}
      bindings={[{
        id: "binding_1",
        label: "交付闭环 v1",
        grantScope: {
          nodeKeys: ["develop"],
          executionPlanes: ["platform"],
          providers: [],
          tools: [],
          commandCategories: [],
          operationTypes: [],
          networkTargets: [],
          recipients: [],
          credentialRefs: [],
        },
      }]}
      agentProfileIds={["profile_codex"]}
      providers={["codex"]}
      onClose={() => undefined}
      onConfirm={vi.fn().mockRejectedValue(Object.assign(new Error("Not found"), { status: 404 }))}
    />);

    await user.click(screen.getByRole("button", { name: "确认授权" }));

    expect((await screen.findByRole("alert")).textContent).toContain("项目 Loop 或自动化授权已不存在，请刷新页面后重试");
  });
});

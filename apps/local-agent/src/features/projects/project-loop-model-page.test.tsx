import type { ProjectLoopCatalogV2 } from "@humanthread/project-loop-sync";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type {
  LoopModelRouting,
  ModelCatalog,
  ModelSitesDocument,
} from "../../lib/local-model-configuration";
import type { NativeLocalModelCommands } from "../../lib/native-local-model-commands";
import { fetchProjectLoopCatalog, ProjectLoopModelEditor } from "./project-loop-model-page";

const siteId = "0123456789abcdef0123456789abcdef";
const modelKey = "fedcba9876543210fedcba9876543210";

const catalog = {
  contractVersion: 2,
  projectId: "project_1",
  catalogVersion: `sha256:${"a".repeat(64)}`,
  projectBindings: [],
  publishedLoops: [{
    loopDefinitionId: "loop_1",
    spaceId: "space_1",
    name: "交付 Loop",
    description: null,
    scope: "project",
    origin: "platform",
    readOnly: true,
    latestPublishedVersionId: "version_1",
    publishedVersions: [{
      loopVersionId: "version_1",
      versionNumber: 1,
      graph: {
        schemaVersion: 2,
        limits: { maxStages: 8, maxRepeatCount: 2 },
        nodes: [
          { key: "start", nodeId: "start", type: "start", label: "开始", offlinePolicy: "online_required" },
          {
            key: "build",
            nodeId: "build",
            type: "agent_action",
            label: "开发",
            offlinePolicy: "local_capable",
            executionTarget: "local",
            responsibility: "实现变更",
            allowedRouteTargets: ["review"],
          },
          {
            key: "review",
            nodeId: "review",
            type: "human_gate",
            label: "人工审核",
            offlinePolicy: "online_required",
            executionTarget: "platform",
            responsibility: "确认结果",
            allowedRouteTargets: ["end"],
          },
          { key: "end", nodeId: "end", type: "end", label: "结束", offlinePolicy: "online_required" },
        ],
        edges: [
          { id: "edge_1", source: "start", target: "build", kind: "normal", outcome: "success" },
          { id: "edge_2", source: "build", target: "review", kind: "normal", outcome: "success" },
          { id: "edge_3", source: "review", target: "end", kind: "normal", outcome: "success" },
        ],
      },
    }],
  }],
} satisfies ProjectLoopCatalogV2;

const sites: ModelSitesDocument = {
  schemaVersion: 2,
  sites: [{
    siteId,
    name: "本地模型站",
    adapter: "openai_compatible",
    baseUrl: "https://models.example.com/v1",
    credentialSource: "environment",
    credentialRef: null,
    status: "ready",
    lastValidatedAt: "2026-08-15T08:00:00.000Z",
  }],
  accountDefault: null,
};

const modelCatalog: ModelCatalog = {
  schemaVersion: 1,
  sites: {
    [siteId]: {
      refreshedAt: "2026-08-15T08:00:00.000Z",
      models: [{ modelKey, name: "coder-v3", label: "Coder V3", manual: false }],
    },
  },
};

const routing: LoopModelRouting = { schemaVersion: 2, loops: {} };

function commands(): NativeLocalModelCommands {
  return {
    getCredentialStatus: vi.fn(),
    setCredential: vi.fn(),
    deleteCredential: vi.fn(),
    listSites: vi.fn(),
    saveSite: vi.fn(),
    saveModelDefaults: vi.fn(),
    deleteSite: vi.fn(),
    getCatalog: vi.fn(),
    saveCatalog: vi.fn(),
    testAndRefreshSite: vi.fn(),
    getRouting: vi.fn(),
    saveRouting: vi.fn().mockImplementation(async (value) => value),
  };
}

describe("Project Loop local model editor", () => {
  it("loads the Loop catalog with device credentials instead of the desktop bearer token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(new Response(JSON.stringify({
      ok: true,
      result: catalog,
    }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(fetchProjectLoopCatalog({
      deploymentOrigin: "https://humanthread.example.com",
      projectId: "project_1",
      userId: "user_1",
      deviceId: "device_1",
      credentials: { apiToken: "", deviceToken: "device_token" },
    }, fetch)).resolves.toEqual(catalog);

    const request = fetch.mock.calls[0]?.[1];
    const headers = new Headers(request?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-agent-device-token")).toBe("device_token");
  });

  it("only exposes model controls for agent action nodes and saves a local overlay", async () => {
    const user = userEvent.setup();
    const localCommands = commands();
    render(<ProjectLoopModelEditor
      catalog={catalog}
      sites={sites}
      modelCatalog={modelCatalog}
      routing={routing}
      commands={localCommands}
    />);

    await user.click(screen.getByRole("button", { name: "节点：人工审核" }));
    expect(screen.queryByLabelText("节点模型模式")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "节点：开发" }));
    expect(screen.getByLabelText("节点模型模式")).toHaveValue("inherit");
    await user.selectOptions(screen.getByLabelText("节点模型模式"), "explicit");
    await user.selectOptions(screen.getByLabelText("节点模型站点"), siteId);
    await user.type(screen.getByRole("combobox", { name: "节点模型" }), modelKey);
    await user.click(screen.getByRole("button", { name: "保存本地模型路由" }));

    await vi.waitFor(() => expect(localCommands.saveRouting).toHaveBeenCalledWith({
      schemaVersion: 2,
      loops: { loop_1: { nodes: { build: { siteId, modelKey, reasoningEffort: "high" } } } },
    }));
    expect(screen.getByText("仅保存到此设备")).toBeVisible();
  }, 10_000);

  it("restores node inheritance without deleting orphaned local entries", async () => {
    const user = userEvent.setup();
    const localCommands = commands();
    render(<ProjectLoopModelEditor
      catalog={catalog}
      sites={sites}
      modelCatalog={modelCatalog}
      routing={{ schemaVersion: 2, loops: { loop_1: { nodes: { removed_node: { siteId, modelKey, reasoningEffort: "high" }, build: { siteId, modelKey, reasoningEffort: "high" } } } } }}
      commands={localCommands}
    />);

    await user.click(screen.getByRole("button", { name: "节点：开发" }));
    await user.click(screen.getByRole("button", { name: "恢复继承" }));
    await user.click(screen.getByRole("button", { name: "保存本地模型路由" }));

    await vi.waitFor(() => expect(localCommands.saveRouting).toHaveBeenCalledWith({
      schemaVersion: 2,
      loops: { loop_1: { nodes: { removed_node: { siteId, modelKey, reasoningEffort: "high" } } } },
    }));
    expect(screen.getByText(/1 个孤立配置/u)).toBeVisible();
  });
});

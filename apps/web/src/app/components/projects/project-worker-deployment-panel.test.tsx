// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectWorkerDeploymentPanel } from "./project-worker-deployment-panel";

afterEach(cleanup);

describe("ProjectWorkerDeploymentPanel", () => {
  it("keeps Git repository configuration out of Worker deployment", () => {
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} workerResource={{ poolId: "a".repeat(32) }} api={{ loadPools: vi.fn().mockResolvedValue([]), savePool: vi.fn(), generateCommands: vi.fn() }} />);

    expect(screen.queryByLabelText("项目仓库 URL")).toBeNull();
    expect(screen.queryByText("仓库 URL")).toBeNull();
  });

  it("shows generated lifecycle commands as not deployed until validation succeeds", async () => {
    const user = userEvent.setup();
    const generateCommands = vi.fn().mockResolvedValue({
      runtime: "docker",
      name: "ht-demo-worker",
      configVersion: 2,
      commands: [
        { operation: "deploy", command: "docker run worker" },
        { operation: "update", command: "docker pull worker" },
        { operation: "uninstall", command: "docker rm worker" },
      ],
    });
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} workerResource={{ poolId: "a".repeat(32) }} api={{ loadPools: vi.fn().mockResolvedValue([{ id: "a".repeat(32), displayName: "Linux Worker", status: "active" }]), savePool: vi.fn(), generateCommands }} />);
    await user.type(screen.getByLabelText("当前密码"), "test-password");
    await user.click(screen.getByRole("button", { name: "生成部署命令" }));

    expect(await screen.findByText("命令已生成，尚未部署")).toBeTruthy();
    expect(screen.getByText("docker run worker")).toBeTruthy();
    expect(screen.getByText("docker pull worker")).toBeTruthy();
    expect(screen.getByText("docker rm worker")).toBeTruthy();
    expect(screen.queryByText("Worker 已就绪")).toBeNull();
    await waitFor(() => expect(generateCommands).toHaveBeenCalledWith({ projectId: "project_1", poolId: "a".repeat(32), runtime: "docker", reauthenticationPassword: "test-password" }));
  });

  it("按原始字节复制 Kubernetes heredoc 命令，并保留换行展示", async () => {
    const user = userEvent.setup();
    const command = "kubectl apply -f - <<'YAML'\napiVersion: v1\nkind: ConfigMap\nYAML";
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    const generateCommands = vi.fn().mockResolvedValue({ runtime: "kubernetes", name: "ht-demo-worker", configVersion: 2, commands: [{ operation: "deploy", command }, { operation: "update", command: "kubectl rollout restart deployment/ht-demo-worker" }, { operation: "uninstall", command: "kubectl delete deployment/ht-demo-worker" }] });
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} workerResource={{ poolId: "a".repeat(32) }} api={{ loadPools: vi.fn().mockResolvedValue([{ id: "a".repeat(32), displayName: "Linux Worker", status: "active" }]), savePool: vi.fn(), generateCommands }} />);

    await user.type(screen.getByLabelText("当前密码"), "test-password");
    await user.click(screen.getByRole("button", { name: "生成部署命令" }));
    await user.click(await screen.findByRole("button", { name: "复制部署命令" }));

    expect(writeText).toHaveBeenCalledWith(command);
    expect(screen.getByTestId("worker-command-deploy").tagName).toBe("PRE");
    expect(screen.getByTestId("worker-command-deploy").textContent).toBe(command);
  });

  it("命令生成仅发送运行时和重新认证信息，避免前端覆盖已保存配置", async () => {
    const user = userEvent.setup();
    const generateCommands = vi.fn().mockResolvedValue({ runtime: "docker", name: "ht-demo-worker", configVersion: 2, commands: [] });
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} environmentConfiguration={{ schemaVersion: 1, entries: [], workerRuntime: { profile: "node-pnpm", mountPath: "/workspace", taskSubpath: "/tasks", variables: [{ name: "PNPM_HOME", value: "/pnpm", pathValue: true }] } }} workerResource={{ poolId: "a".repeat(32) }} api={{ loadPools: vi.fn().mockResolvedValue([{ id: "a".repeat(32), displayName: "Linux Worker", status: "active" }]), savePool: vi.fn(), generateCommands }} />);

    await user.type(screen.getByLabelText("当前密码"), "test-password");
    await user.click(screen.getByRole("button", { name: "生成部署命令" }));

    await waitFor(() => expect(generateCommands).toHaveBeenCalledWith({ projectId: "project_1", poolId: "a".repeat(32), runtime: "docker", reauthenticationPassword: "test-password" }));
  });

  it("从镜像目录选择版本并保存项目引用", async () => {
    const user = userEvent.setup();
    const poolId = "a".repeat(32);
    const versionId = "c".repeat(32);
    const saveImageVersion = vi.fn().mockResolvedValue({ version: 4, workerImageVersionId: versionId });
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} workerResource={{ poolId }} api={{ loadPools: vi.fn().mockResolvedValue([{ id: poolId, displayName: "Linux Worker", status: "active" }]), loadImageSources: vi.fn().mockResolvedValue([{ id: "d".repeat(32), ownerType: "platform", companyId: null, name: "正式 Worker", repository: "registry.example.com/worker", versions: [{ id: versionId, tag: "20260916-a", digest: `sha256:${"b".repeat(64)}`, publishedAt: null }] }]), savePool: vi.fn(), saveImageVersion, generateCommands: vi.fn() }} />);
    await screen.findByRole("option", { name: "正式 Worker" });
    await user.selectOptions(screen.getByLabelText("Worker 镜像来源"), "d".repeat(32));
    await user.selectOptions(screen.getByLabelText("Worker 镜像版本"), versionId);
    expect((screen.getByLabelText("Worker 镜像 Digest") as HTMLInputElement).value).toBe(`sha256:${"b".repeat(64)}`);
    await user.click(screen.getByRole("button", { name: "保存 Worker 镜像版本" }));
    await waitFor(() => expect(saveImageVersion).toHaveBeenCalledWith({ expectedVersion: 3, workerImageVersionId: versionId }));
  });

  it("异步加载目录后保留项目已保存镜像版本对应的来源", async () => {
    const poolId = "a".repeat(32);
    const sourceId = "d".repeat(32);
    const versionId = "c".repeat(32);
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} workerImageVersionId={versionId} workerResource={{ poolId }} api={{ loadPools: vi.fn().mockResolvedValue([{ id: poolId, displayName: "Linux Worker", status: "active" }]), loadImageSources: vi.fn().mockResolvedValue([{ id: sourceId, ownerType: "platform", companyId: null, name: "正式 Worker", repository: "registry.example.com/worker", versions: [{ id: versionId, tag: "20260916-a", digest: `sha256:${"b".repeat(64)}`, publishedAt: null }] }]), savePool: vi.fn(), saveImageVersion: vi.fn(), generateCommands: vi.fn() }} />);

    await screen.findByRole("option", { name: "正式 Worker" });
    await waitFor(() => expect((screen.getByLabelText("Worker 镜像来源") as HTMLSelectElement).value).toBe(sourceId));
    expect((screen.getByLabelText("Worker 镜像版本") as HTMLSelectElement).value).toBe(versionId);
    expect((screen.getByLabelText("Worker 镜像 Digest") as HTMLInputElement).value).toBe(`sha256:${"b".repeat(64)}`);
  });

  it("保存 PVC 容量和 HPA 副本范围后再生成命令", async () => {
    const user = userEvent.setup();
    const poolId = "a".repeat(32);
    const saveDeploymentConfiguration = vi.fn().mockResolvedValue({
      version: 4,
      environmentConfigurationVersion: 3,
      configuration: { schemaVersion: 1, kubernetes: { namespace: "etl", persistentStorage: "30Gi", minReplicas: 2, maxReplicas: 5 }, concurrency: 1, healthPort: 8080, capabilities: { workspace: true, files: true, commands: true } },
    });
    const generateCommands = vi.fn().mockResolvedValue({ runtime: "kubernetes", name: "ht-demo-worker", configVersion: 3, commands: [] });
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} deploymentConfiguration={{ schemaVersion: 1, kubernetes: { namespace: "etl", persistentStorage: "10Gi", minReplicas: 1, maxReplicas: 3 }, concurrency: 1, healthPort: 8080, capabilities: { workspace: true, files: true, commands: true } }} workerResource={{ poolId }} api={{ loadPools: vi.fn().mockResolvedValue([{ id: poolId, displayName: "Linux Worker", status: "active" }]), savePool: vi.fn(), saveDeploymentConfiguration, generateCommands }} />);

    await user.click(screen.getByRole("radio", { name: "Kubernetes" }));
    await user.clear(screen.getByLabelText("PVC 容量"));
    await user.type(screen.getByLabelText("PVC 容量"), "30Gi");
    fireEvent.change(screen.getByLabelText("HPA 最小副本"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("HPA 最大副本"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "保存 Worker 部署配置" }));

    await waitFor(() => expect(saveDeploymentConfiguration).toHaveBeenCalledWith(expect.objectContaining({
      expectedVersion: 3,
      configuration: expect.objectContaining({ kubernetes: expect.objectContaining({ persistentStorage: "30Gi", minReplicas: 2, maxReplicas: 5 }) }),
    })));
    await user.type(screen.getByLabelText("当前密码"), "test-password");
    await user.click(screen.getByRole("button", { name: "生成部署命令" }));
    await waitFor(() => expect(generateCommands).toHaveBeenCalledWith({ projectId: "project_1", poolId, runtime: "kubernetes", reauthenticationPassword: "test-password" }));
  });

  it("连续保存 Worker Pool 与目录镜像时使用服务端返回的最新项目版本", async () => {
    const user = userEvent.setup();
    const poolId = "a".repeat(32);
    const sourceId = "c".repeat(32);
    const versionId = "d".repeat(32);
    const savePool = vi.fn().mockResolvedValue({ version: 4 });
    const saveImageVersion = vi.fn().mockResolvedValue({ version: 5, workerImageVersionId: versionId });

    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} workerResource={{ poolId }} api={{ loadPools: vi.fn().mockResolvedValue([{ id: poolId, displayName: "Linux Worker", status: "active" }]), loadImageSources: vi.fn().mockResolvedValue([{ id: sourceId, ownerType: "platform", companyId: null, name: "正式 Worker", repository: "registry.example.com/worker", versions: [{ id: versionId, tag: "20260916-a", digest: `sha256:${"b".repeat(64)}`, publishedAt: null }] }]), savePool, saveImageVersion, generateCommands: vi.fn() }} />);

    await user.click(screen.getByRole("button", { name: "保存 Worker Pool" }));
    expect(await screen.findByText("项目 Worker Pool 已保存。请继续生成部署命令。")).toBeTruthy();

    await screen.findByRole("option", { name: "正式 Worker" });
    await user.selectOptions(screen.getByLabelText("Worker 镜像来源"), sourceId);
    await user.selectOptions(screen.getByLabelText("Worker 镜像版本"), versionId);
    await user.click(screen.getByRole("button", { name: "保存 Worker 镜像版本" }));

    await waitFor(() => expect(saveImageVersion).toHaveBeenCalledWith(expect.objectContaining({ expectedVersion: 4 })));
  });

  it("does not reload worker pools after an unrelated form update", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ pools: [{ id: "a".repeat(32), displayName: "Linux Worker", status: "active" }] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} />);

    await screen.findByRole("option", { name: "Linux Worker" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("按平台与公司分组展示项目可选镜像", async () => {
    const poolId = "a".repeat(32);
    const versionId = "c".repeat(32);
    render(<ProjectWorkerDeploymentPanel
      projectId="project_1"
      projectShortCode="DEMO"
      projectVersion={3}
      environmentConfigurationVersion={2}
      workerResource={{ poolId }}
      api={{
        loadPools: vi.fn().mockResolvedValue([{ id: poolId, displayName: "Linux Worker", status: "active" }]),
        loadImageSources: vi.fn().mockResolvedValue([
          { id: "d".repeat(32), ownerType: "platform", companyId: null, name: "平台 Worker", repository: "registry.example.com/platform", versions: [{ id: versionId, tag: "platform", digest: `sha256:${"b".repeat(64)}`, publishedAt: null }] },
          { id: "e".repeat(32), ownerType: "company", companyId: "company_1", name: "公司 Worker", repository: "registry.example.com/company", versions: [{ id: "f".repeat(32), tag: "company", digest: `sha256:${"c".repeat(64)}`, publishedAt: null }] },
        ]),
        savePool: vi.fn(),
        generateCommands: vi.fn(),
      }}
    />);

    expect(await screen.findByRole("group", { name: "平台镜像" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "公司镜像" })).toBeTruthy();
  });

  it("项目镜像 API 请求携带项目标识以包含公司镜像", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ pools: [] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true, sources: [] }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ProjectWorkerDeploymentPanel projectId="project_1" projectShortCode="DEMO" projectVersion={3} environmentConfigurationVersion={2} />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/worker-images/sources?projectId=project_1"));
  });
});

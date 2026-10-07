import type {
  DesktopProjectDetail,
  WorkspaceConfigurationRevokeRequest,
  WorkspaceConfigurationUpsertRequest,
} from "@humanthread/workbench-client";
import {
  CheckCircle2,
  FolderCog,
  FolderOpen,
  RefreshCw,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";

import type { LocalExecutionConfigStore } from "../../desktop/execution-config-store";
import { buildWorkspaceUpload, type LocalWorkspaceConfiguration } from "../../lib/execution-configuration";
import type { LocalRuntime } from "../../lib/runtime";

type ServerWorkspace = NonNullable<DesktopProjectDetail["workspace"]>;

function createCommandId(scope: string): string {
  const id = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${scope}:${id}`.slice(0, 128);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "本地目录配置失败";
}

export function ProjectWorkspaceSettings(props: {
  projectId: string;
  nativeAvailable: boolean;
  serverWorkspace: DesktopProjectDetail["workspace"];
  store: LocalExecutionConfigStore | null;
  runtime: LocalRuntime;
  saveWorkspace(input: WorkspaceConfigurationUpsertRequest): Promise<ServerWorkspace>;
  removeWorkspace?(input: WorkspaceConfigurationRevokeRequest): Promise<void>;
  onRefresh?(): void | Promise<void>;
}) {
  const [workspace, setWorkspace] = useState<LocalWorkspaceConfiguration | null>(null);
  const [loading, setLoading] = useState(Boolean(props.store));
  const [pending, setPending] = useState<"select" | "folder" | "terminal" | "remove" | null>(null);
  const [confirmingRemoval, setConfirmingRemoval] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let disposed = false;
    if (!props.store) {
      setWorkspace(null);
      setLoading(false);
      return () => { disposed = true; };
    }
    setLoading(true);
    void props.store.getWorkspace(props.projectId).then(
      (value) => { if (!disposed) setWorkspace(value); },
      (error: unknown) => {
        if (!disposed) setNotice({ tone: "error", text: errorMessage(error) });
      },
    ).finally(() => { if (!disposed) setLoading(false); });
    return () => { disposed = true; };
  }, [props.projectId, props.store]);

  const available = props.nativeAvailable && Boolean(props.store);
  const configured = available && Boolean(workspace);

  async function chooseDirectory() {
    if (!available || !props.store) return;
    setPending("select");
    setNotice(null);
    try {
      const selected = await props.runtime.selectProjectDirectory();
      if (!selected) return;
      const validated = await props.runtime.validateWorkspaceDirectory(selected);
      const nextVersion = Math.max(
        props.serverWorkspace?.configurationVersion ?? 0,
        workspace?.configurationVersion ?? 0,
      ) + 1;
      const local = await props.store.setWorkspace(props.projectId, {
        bindingId: props.serverWorkspace?.bindingId ?? null,
        absolutePath: validated.absolutePath,
        realpath: validated.realpath,
        configurationVersion: nextVersion,
      });
      setWorkspace(local);
      const upload = buildWorkspaceUpload(local);
      const saved = await props.saveWorkspace({
        commandId: createCommandId("workspace-upsert"),
        ...(props.serverWorkspace
          ? { expectedVersion: props.serverWorkspace.configurationVersion }
          : {}),
        status: "ready",
        pathFingerprint: upload.pathFingerprint,
        validatedAt: new Date().toISOString(),
      });
      const synchronized = await props.store.setWorkspace(props.projectId, {
        bindingId: saved.bindingId,
        absolutePath: local.absolutePath,
        realpath: local.realpath,
        configurationVersion: saved.configurationVersion,
      });
      setWorkspace(synchronized);
      setNotice({ tone: "success", text: "本地目录与平台状态已同步" });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
      await props.onRefresh?.();
    } finally {
      setPending(null);
    }
  }

  async function openDirectory(kind: "folder" | "terminal") {
    if (!workspace || !configured) return;
    setPending(kind);
    setNotice(null);
    try {
      if (kind === "folder") await props.runtime.openProjectPath(workspace.realpath);
      else await props.runtime.openTerminalAtPath(workspace.realpath);
      setNotice({ tone: "success", text: kind === "folder" ? "已打开项目目录" : "终端已就绪" });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
    } finally {
      setPending(null);
    }
  }

  async function removeDirectory() {
    if (!props.store || !workspace) return;
    setPending("remove");
    setNotice(null);
    try {
      await props.store.removeWorkspace(props.projectId);
      setWorkspace(null);
      if (props.serverWorkspace && props.removeWorkspace) {
        await props.removeWorkspace({
          commandId: createCommandId("workspace-revoke"),
          expectedVersion: props.serverWorkspace.configurationVersion,
        });
      }
      setConfirmingRemoval(false);
      setNotice({ tone: "success", text: "当前设备的目录映射已移除" });
    } catch (error) {
      setNotice({ tone: "error", text: errorMessage(error) });
      await props.onRefresh?.();
    } finally {
      setPending(null);
    }
  }

  const status = !available
    ? "仅桌面客户端可配置"
    : loading
      ? "正在读取本机配置"
      : workspace
        ? "当前设备已配置"
        : "尚未配置本地目录";

  return (
    <div className="project-workspace-settings">
      <div className="workspace-settings-status" data-ready={configured}>
        {configured ? <CheckCircle2 aria-hidden="true" size={17} /> : <FolderCog aria-hidden="true" size={17} />}
        <span><strong>{status}</strong><small>{workspace?.absolutePath ?? "每台设备独立保存项目目录"}</small></span>
      </div>
      <button
        className="workspace-select-action"
        disabled={!available || loading || pending !== null}
        onClick={() => void chooseDirectory()}
        type="button"
      >
        {pending === "select" ? <RefreshCw aria-hidden="true" className="is-spinning" size={15} /> : <FolderCog aria-hidden="true" size={15} />}
        {workspace ? "更换项目目录" : "选择项目目录"}
      </button>
      <div className="local-native-actions workspace-native-actions">
        <button aria-label="打开项目目录" disabled={!configured || pending !== null} onClick={() => void openDirectory("folder")} title="打开项目目录" type="button"><FolderOpen size={17} /></button>
        <button aria-label="在终端打开" disabled={!configured || pending !== null} onClick={() => void openDirectory("terminal")} title="在终端打开" type="button"><SquareTerminal size={17} /></button>
        <button aria-label="移除目录映射" disabled={!configured || pending !== null} onClick={() => setConfirmingRemoval(true)} title="移除目录映射" type="button"><Trash2 size={17} /></button>
      </div>
      {confirmingRemoval ? (
        <div className="workspace-remove-confirm" role="group" aria-label="确认移除目录映射">
          <span>移除后，本机 Loop 将等待重新配置。</span>
          <button disabled={pending !== null} onClick={() => setConfirmingRemoval(false)} type="button"><X size={14} />取消</button>
          <button disabled={pending !== null} onClick={() => void removeDirectory()} type="button"><Trash2 size={14} />确认移除</button>
        </div>
      ) : null}
      <p className="local-action-notice">Agent 只在此目录范围内执行；平台仅保存校验指纹。</p>
      {notice ? <p className="local-action-notice workspace-settings-notice" data-tone={notice.tone} role={notice.tone === "error" ? "alert" : "status"}>{notice.text}</p> : null}
    </div>
  );
}

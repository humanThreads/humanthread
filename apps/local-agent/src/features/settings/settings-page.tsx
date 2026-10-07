import {
  desktopAgentRuntimeCollectionResponseSchema,
  desktopAgentRuntimeMutationResponseSchema,
  desktopSettingsResponseSchema,
  type DeviceRuntimeProfileUpsertRequest,
  type DesktopSettingsResponse,
} from "@humanthread/workbench-client";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Building2, Check, Mail, ShieldCheck, UserRound, UsersRound } from "lucide-react";
import type { ReactNode } from "react";

import { createNativeExecutionConfigStore } from "../../desktop/execution-config-store";
import { getNativeBridge } from "../../lib/native-bridge";
import type { LocalRuntime } from "../../lib/runtime";
import { createNativeLocalModelCommands } from "../../lib/native-local-model-commands";
import { useDesktopSession } from "../../session/session-provider";
import { AppearanceSettings } from "../../theme/appearance-settings";
import { AGENT_BUILD_VERSION } from "../../lib/build-version";
import { useDesktopReadModel } from "../read-first/read-model-query";
import { ReadModelError, ReadModelLoading } from "../read-first/read-model-state";
import { AgentRuntimeSettings, type RuntimeProfile } from "./agent-runtime-settings";
import { CodexAppServerDiagnostics } from "./codex-app-server-diagnostics";

type SettingsData = DesktopSettingsResponse["data"];
type CompanyDetails = NonNullable<SettingsData["selectedCompany"]>;

const ROLE_LABELS = {
  owner: "所有者",
  admin: "管理员",
  member: "成员",
  viewer: "访客",
} as const;

function permissionLabels(membership: CompanyDetails["membership"]): string[] {
  return [
    membership.canManageProfile ? "公司资料" : null,
    membership.canManageMembers ? "成员管理" : null,
    membership.canManageIntegrations ? "集成配置" : null,
    membership.canTransferOwnership ? "所有权转移" : null,
  ].filter((value): value is string => Boolean(value));
}

function CompanySettings(props: { details: CompanyDetails }) {
  const permissions = permissionLabels(props.details.membership);
  return (
    <section aria-labelledby="settings-company-title" className="settings-domain-section">
      <header>
        <span className="settings-section-icon"><Building2 aria-hidden="true" size={18} /></span>
        <div><h2 id="settings-company-title">{props.details.company.name}</h2><p>{props.details.profile.description ?? "未设置公司简介"}</p></div>
        <em>{ROLE_LABELS[props.details.membership.role]}</em>
      </header>
      <div className="settings-company-facts">
        <dl><div><dt>标识</dt><dd>{props.details.company.slug}</dd></div><div><dt>状态</dt><dd>{props.details.company.status}</dd></div><div><dt>认证</dt><dd>{props.details.profile.certificationLevel}</dd></div></dl>
        <div className="settings-permissions"><strong><ShieldCheck size={15} />当前权限</strong>{permissions.length > 0 ? permissions.map((permission) => <span key={permission}><Check size={13} />{permission}</span>) : <span>只读访问</span>}</div>
      </div>
      <div className="settings-subsection">
        <header><h3><UsersRound size={15} />公司成员</h3><span>{props.details.members.length} 人</span></header>
        <div className="settings-member-list">{props.details.members.map((member) => (
          <div key={member.id}><span className="read-domain-avatar" aria-hidden="true">{member.user.name.slice(0, 1).toUpperCase()}</span><span><strong>{member.user.name}</strong><small>{member.user.email ?? "未公开邮箱"}</small></span><em>{ROLE_LABELS[member.role]}</em></div>
        ))}</div>
      </div>
      {props.details.integration ? (
        <div className="settings-subsection settings-integration">
          <header><h3><Mail size={15} />邮件集成</h3><span>{props.details.integration.hasPassword ? "凭据已配置" : "未配置凭据"}</span></header>
          <dl><div><dt>服务地址</dt><dd>{props.details.integration.emailHost && props.details.integration.emailPort ? `${props.details.integration.emailHost}:${props.details.integration.emailPort}` : "未配置"}</dd></div><div><dt>发送账号</dt><dd>{props.details.integration.emailUsername ?? "未配置"}</dd></div></dl>
        </div>
      ) : null}
    </section>
  );
}

export function SettingsView(props: { data: SettingsData; runtimeSettings?: ReactNode }) {
  const [tab, setTab] = useState<"environment" | "account" | "desktop" | "diagnostics">("account");
  const tabs = [
    ["environment", "本地执行环境"],
    ["account", "账号与空间"],
    ["desktop", "桌面偏好"],
    ["diagnostics", "诊断"],
  ] as const;
  return (
    <div className="settings-workspace settings-tabbed-workspace">
      <nav aria-label="设置分区" className="settings-tabs" role="tablist">
        {tabs.map(([key, label]) => <button aria-selected={tab === key} key={key} onClick={() => setTab(key)} role="tab" type="button">{label}</button>)}
      </nav>
      <div className="settings-tab-content">
        {tab === "environment" ? props.runtimeSettings : null}
        {tab === "account" ? (
          <>
            <section aria-labelledby="settings-account-title" className="settings-domain-section settings-account-section">
              <header>
                <span className="settings-section-icon"><UserRound aria-hidden="true" size={18} /></span>
                <div><h2 id="settings-account-title">{props.data.user.name}</h2><p>{props.data.user.email ?? "未公开邮箱"}</p></div>
                <em>{props.data.isSiteAdmin ? "平台管理员" : props.data.user.status}</em>
              </header>
              <div className="settings-company-memberships">
                <strong>所属公司</strong>
                {props.data.companies.map((company) => <span key={company.id}><Building2 size={14} />{company.name}<small>{ROLE_LABELS[company.role]}</small></span>)}
                {props.data.companies.length === 0 ? <span>当前账号未加入公司</span> : null}
              </div>
            </section>
            {props.data.selectedCompany ? <CompanySettings details={props.data.selectedCompany} /> : null}
          </>
        ) : null}
        {tab === "desktop" ? (
          <section aria-labelledby="settings-appearance-title" className="settings-domain-section settings-appearance-section">
            <header><span className="settings-section-icon"><ShieldCheck aria-hidden="true" size={18} /></span><div><h2 id="settings-appearance-title">桌面偏好</h2><p>外观偏好只保存在当前安装中。</p></div></header>
            <AppearanceSettings />
          </section>
        ) : null}
        {tab === "diagnostics" ? (
          <section className="settings-domain-section settings-diagnostics-section">
            <header><span className="settings-section-icon"><ShieldCheck aria-hidden="true" size={18} /></span><div><h2>诊断</h2><p>只显示版本、连接和执行状态摘要，不记录令牌或任务正文。</p></div></header>
            <dl className="settings-company-facts"><div><dt>客户端版本</dt><dd>{AGENT_BUILD_VERSION}</dd></div><div><dt>桌面会话</dt><dd>{props.data.user.status === "active" ? "已连接" : "不可用"}</dd></div><div><dt>开箱向导</dt><dd>可在左侧“开箱向导”重新运行检查</dd></div></dl>
          </section>
        ) : null}
      </div>
    </div>
  );
}

export function SettingsPage(props: { runtime: LocalRuntime }) {
  const session = useDesktopSession();
  const query = useDesktopReadModel({
    domain: "settings",
    endpoint: "/api/desktop/settings",
    schema: desktopSettingsResponseSchema,
  });
  const runtimesQuery = useDesktopReadModel({
    domain: "agent-runtime-settings",
    endpoint: "/api/desktop/agent-runtimes",
    schema: desktopAgentRuntimeCollectionResponseSchema,
  });
  const storeQuery = useQuery({
    enabled: Boolean(props.runtime.isNative && session.localDeviceId),
    queryKey: ["desktop", "execution-configuration", session.localDeviceId ?? "disabled"],
    queryFn: () => createNativeExecutionConfigStore({ deviceId: session.localDeviceId ?? "" }),
    staleTime: Infinity,
  });
  const localModelCommands = useMemo(() => {
    if (!props.runtime.isNative || !session.context || !session.user) return null;
    const bridge = getNativeBridge();
    if (!bridge) return null;
    return createNativeLocalModelCommands({
      deploymentOrigin: session.context.deploymentKey,
      userId: session.user.id,
    }, (command, args) => bridge.invoke(command, args));
  }, [props.runtime.isNative, session.context, session.user]);

  if (query.isPending || runtimesQuery.isPending) return <ReadModelLoading label="正在加载设置" />;
  if (query.isError) return <ReadModelError message={query.error.message} onRetry={() => void query.refetch()} />;
  if (runtimesQuery.isError) {
    return <ReadModelError message={runtimesQuery.error.message} onRetry={() => void runtimesQuery.refetch()} />;
  }
  if (storeQuery.isError) {
    return <ReadModelError message={storeQuery.error.message} onRetry={() => void storeQuery.refetch()} />;
  }

  /**
   * Reads the local site document and model catalogue so the runtime profile
   * upload can carry the site list the platform needs for its model picker.
   * Only names and labels are reported; baseUrl and credential references stay
   * on this device.
   */
  const loadModelSitesForUpload = async () => {
    const commands = localModelCommands;
    if (!commands) return [];
    const [document, catalog] = await Promise.all([commands.listSites(), commands.getCatalog()]);
    return document.sites.map((site) => ({
      siteId: site.siteId,
      name: site.name,
      adapter: site.adapter,
      models: (catalog.sites[site.siteId]?.models ?? []).map((entry) => ({
        name: entry.name,
        label: entry.label,
      })),
    }));
  };

  const saveRuntime = async (input: DeviceRuntimeProfileUpsertRequest): Promise<RuntimeProfile> => {
    if (!session.client || !session.context) throw new Error("桌面会话不可用");
    const search = new URLSearchParams({ space: session.context.spaceKey });
    const response = await session.client.request(
      `/api/desktop/agent-runtimes?${search.toString()}`,
      desktopAgentRuntimeMutationResponseSchema,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...input,
          modelSites: input.modelSites ?? await loadModelSitesForUpload().catch(() => []),
        }),
      },
    );
    return response.data.runtimeProfile;
  };

  return <SettingsView
    data={query.data.data}
    runtimeSettings={(
      <>
        <AgentRuntimeSettings
          nativeAvailable={Boolean(
            props.runtime.isNative
            && session.bootstrap?.capabilities.nativeExecution
            && session.actionsEnabled,
          )}
          onRefresh={async () => { await runtimesQuery.refetch(); }}
          runtime={props.runtime}
          runtimeProfiles={runtimesQuery.data.data.runtimeProfiles}
          saveRuntime={saveRuntime}
          store={storeQuery.data ?? null}
          localModelAccount={session.context && session.user ? {
            deploymentOrigin: session.context.deploymentKey,
            userId: session.user.id,
          } : null}
          localModelCommands={localModelCommands}
        />
        <CodexAppServerDiagnostics enabled={Boolean(props.runtime.isNative && session.actionsEnabled)} />
      </>
    )}
  />;
}

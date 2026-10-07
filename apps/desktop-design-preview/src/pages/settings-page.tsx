import { desktopSettingsResponseSchema } from "@humanthread/workbench-client";
import { Bell, Laptop, RefreshCcw, ShieldCheck } from "lucide-react";
import { useState, type ReactNode } from "react";

import { loadOnboardingState } from "../onboarding/onboarding-state";
import { usePreviewReadModel } from "../session/preview-session";
import { AsyncState, PageHeader, StatusPill, SurfaceHeader, SurfacePanel } from "../ui/primitives";

type SettingsTab = "environment" | "account" | "desktop" | "diagnostics";

const TABS: Array<{ key: SettingsTab; label: string }> = [
  { key: "environment", label: "本地执行环境" },
  { key: "account", label: "账号与空间" },
  { key: "desktop", label: "桌面偏好" },
  { key: "diagnostics", label: "诊断" },
];

export function SettingsPage() {
  const [tab, setTab] = useState<SettingsTab>("environment");
  const onboarding = loadOnboardingState(window.localStorage);
  const query = usePreviewReadModel({
    domain: "settings",
    endpoint: "/api/desktop/settings",
    schema: desktopSettingsResponseSchema,
  });
  const data = query.data?.data;

  return (
    <div className="page-stack">
      <PageHeader description="管理本地执行环境、账号空间、桌面偏好与诊断状态。" title="设置" />
      <AsyncState
        error={query.error instanceof Error ? query.error.message : null}
        label="正在加载设置"
        onRetry={() => void query.refetch()}
        status={query.isPending ? "pending" : query.isError ? "error" : "success"}
      >
        {data ? (
          <section className="settings-layout">
            <nav aria-label="设置分区" className="settings-tabs" role="tablist">
              {TABS.map((item) => <button aria-selected={tab === item.key} key={item.key} onClick={() => setTab(item.key)} role="tab" type="button">{item.label}</button>)}
            </nav>
            <div className="settings-content">
              {tab === "environment" ? (
                <SurfacePanel>
                  <SurfaceHeader title="本地执行环境" description="正式 Desktop 通过原生桥接验证这些配置。" />
                  <div className="settings-grid">
                    <SettingsRow icon={<Laptop aria-hidden="true" size={17} />} label="Workspace" value="未绑定" />
                    <SettingsRow icon={<ShieldCheck aria-hidden="true" size={17} />} label="Agent runtime" value="未探测" />
                    <SettingsRow icon={<RefreshCcw aria-hidden="true" size={17} />} label="真实执行" value={onboarding.executionEnabled ? "已开启" : "默认关闭"} tone={onboarding.executionEnabled ? "danger" : "success"} />
                  </div>
                </SurfacePanel>
              ) : null}
              {tab === "account" ? (
                <SurfacePanel><SurfaceHeader title="账号与空间" /><div className="settings-grid"><SettingsRow label="账号" value={data.user.name} /><SettingsRow label="邮箱" value={data.user.email ?? "未设置"} /><SettingsRow label="公司" value={data.selectedCompany?.company.name ?? "个人空间"} /></div></SurfacePanel>
              ) : null}
              {tab === "desktop" ? (
                <SurfacePanel><SurfaceHeader title="桌面偏好" /><div className="settings-grid"><SettingsRow icon={<Bell aria-hidden="true" size={17} />} label="通知" value="站内通知与原生通知去重" /><SettingsRow label="外观" value="浅色操作台" /><SettingsRow label="启动行为" value="登录后进入首页" /></div></SurfacePanel>
              ) : null}
              {tab === "diagnostics" ? (
                <SurfacePanel><SurfaceHeader title="诊断" description="只展示状态摘要，不展示令牌或请求正文。" /><div className="settings-grid"><SettingsRow label="Desktop session" value="已连接" tone="success" /><SettingsRow label="预览设备" value="独立身份" /><SettingsRow label="执行桥接" value="未连接" tone="warning" /></div></SurfacePanel>
              ) : null}
            </div>
          </section>
        ) : null}
      </AsyncState>
    </div>
  );
}

function SettingsRow(props: {
  icon?: ReactNode;
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  return <div className="settings-row">{props.icon}<span><strong>{props.label}</strong><small>{props.value}</small></span>{props.tone ? <StatusPill tone={props.tone}>已配置</StatusPill> : null}</div>;
}

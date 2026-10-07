import Link from "next/link";
import type { ReactNode } from "react";

export type ProjectSettingsTab = "overview" | "short-code" | "loops" | "environment" | "workers" | "onboarding";

const tabs: Array<{ key: ProjectSettingsTab; label: string }> = [
  { key: "overview", label: "项目概览" },
  { key: "short-code", label: "项目简称" },
  { key: "loops", label: "Loop 工作流" },
  { key: "environment", label: "环境与凭证" },
  { key: "workers", label: "Worker 部署" },
  { key: "onboarding", label: "开箱向导" },
];

export function ProjectSettingsTabs({ projectId, activeTab, canEdit, children }: { projectId: string; activeTab: ProjectSettingsTab; canEdit: boolean; children: ReactNode }) {
  return <div className="grid gap-4">
    <nav aria-label="项目设置" className="flex flex-wrap gap-1 border-b border-[#d0d7de]">
      {tabs.filter((tab) => canEdit || tab.key === "overview").map((tab) => <Link key={tab.key} href={`/projects/${encodeURIComponent(projectId)}/settings?tab=${tab.key}`} aria-current={activeTab === tab.key ? "page" : undefined} className={`border-b-2 px-3 py-3 text-sm font-semibold ${activeTab === tab.key ? "border-[#0969da] text-[#0969da]" : "border-transparent text-[#57606a] hover:border-[#8c959f] hover:text-[#24292f]"}`}>{tab.label}</Link>)}
    </nav>
    {children}
  </div>;
}

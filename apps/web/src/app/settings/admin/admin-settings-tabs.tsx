import Link from "next/link";

export type AdminSettingsTab = "site" | "storage" | "worker-images";

const tabs: Array<{ key: AdminSettingsTab; label: string }> = [
  { key: "site", label: "站点域名" },
  { key: "storage", label: "文件存储" },
  { key: "worker-images", label: "Worker 镜像目录" },
];

export function AdminSettingsTabs({ activeTab }: { activeTab: AdminSettingsTab }) {
  return <nav aria-label="平台设置" className="flex flex-wrap gap-1 border-b border-[#d0d7de]">
    {tabs.map((tab) => <Link
      key={tab.key}
      href={`/settings/admin?tab=${tab.key}`}
      aria-current={activeTab === tab.key ? "page" : undefined}
      className={`border-b-2 px-3 py-3 text-sm font-semibold ${activeTab === tab.key ? "border-[#0969da] text-[#0969da]" : "border-transparent text-[#57606a] hover:border-[#8c959f] hover:text-[#24292f]"}`}
    >{tab.label}</Link>)}
  </nav>;
}

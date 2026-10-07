import Link from "next/link";
import { Bot, FileText, History, Users } from "lucide-react";
import type { ProjectHubView } from "../../../lib/workbench/workbench-projects";
import { Panel } from "../workbench-ui";

export function ProjectResourcePanel({ projectId, resources }: { projectId: string; resources: ProjectHubView["resources"] }) {
  const items = [{ href: `/documents?project=${encodeURIComponent(projectId)}`, label: "项目文档", value: resources.documents, icon: FileText }, { href: `/projects/${projectId}/members`, label: "项目成员", value: resources.members, icon: Users }, { href: `/projects/${projectId}/activity`, label: "决策与活动", value: resources.activities, icon: History }, { href: `/agents?project=${encodeURIComponent(projectId)}`, label: "自动化摘要", value: resources.automationState, icon: Bot }];
  return <Panel title="项目资源"><div className="grid gap-2 sm:grid-cols-2">{items.map((item) => <Link key={item.href} href={item.href} className="flex items-center gap-3 rounded-md border border-[#d0d7de] px-3 py-3 hover:bg-[#f6f8fa]"><item.icon className="size-4 text-[#57606a]" /><span className="mr-auto text-sm font-medium text-[#24292f]">{item.label}</span><span className="text-xs text-[#57606a]">{item.value}</span></Link>)}</div></Panel>;
}

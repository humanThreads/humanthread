"use client";

import { useRouter } from "next/navigation";

export function DocumentProjectSwitcher({
  projects,
  selectedProjectId,
  companyDocumentsHref,
  onProjectChange,
}: {
  projects: Array<{ id: string; name: string }>;
  selectedProjectId?: string;
  companyDocumentsHref: string;
  onProjectChange?: (projectId: string | null) => void;
}) {
  const router = useRouter();
  function changeProject(projectId: string) {
    const next = projectId === "__company__" ? companyDocumentsHref : `/documents?project=${encodeURIComponent(projectId)}`;
    if (onProjectChange) onProjectChange(projectId === "__company__" ? null : projectId);
    else router.replace(next);
  }
  return (
    <div className="flex min-w-0 items-center gap-1.5 text-sm">
      <label className="sr-only" htmlFor="document-project-select">当前项目</label>
      <select id="document-project-select" aria-label="当前项目" value={selectedProjectId ?? "__company__"} onChange={(event) => changeProject(event.currentTarget.value)} className="min-w-0 max-w-[min(48vw,220px)] rounded-md border border-[#d0d7de] bg-white px-2 py-1 text-xs font-medium text-[#24292f]">
          <option value="__company__">公司文档</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
      </select>
    </div>
  );
}

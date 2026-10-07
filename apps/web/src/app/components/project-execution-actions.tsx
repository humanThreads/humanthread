"use client";

import { Plus } from "lucide-react";
import { useState } from "react";
import { ProjectTaskDispatchDialog } from "./project-task-dispatch-dialog";

export function ProjectExecutionActions({ projectId, milestones }: { projectId: string; milestones: Array<{ id: string; name: string }> }) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  return <>
    <button type="button" onClick={() => setDispatchOpen(true)} className="inline-flex h-9 items-center gap-2 rounded-md bg-[#1f883d] px-3 text-sm font-semibold text-white hover:bg-[#1a7f37]"><Plus className="size-4" />派发任务</button>
    <ProjectTaskDispatchDialog open={dispatchOpen} projectId={projectId} milestones={milestones} profiles={[]} onClose={() => setDispatchOpen(false)} />
  </>;
}

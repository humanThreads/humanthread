import { loopAuthoringGraphSchema } from "@humanthread/orchestration-core";
import { projectLoopGraphToFlow } from "../loops/project-loop-flow";

export type DevelopmentTemplateLoopPreview = {
  id: string;
  versionNumber: number;
  graph?: unknown;
  definition?: { id: string; name: string; scope: string };
};

export function normalizeDevelopmentTemplateLoopVersions(value: unknown): DevelopmentTemplateLoopPreview[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (typeof record.id !== "string" || !Number.isInteger(record.versionNumber)) return [];
    const rawDefinition = record.definition ?? record.loopDefinition;
    if (!rawDefinition || typeof rawDefinition !== "object") return [];
    const definition = rawDefinition as Record<string, unknown>;
    if (typeof definition.id !== "string" || typeof definition.name !== "string" || typeof definition.scope !== "string") return [];
    return [{ id: record.id, versionNumber: record.versionNumber as number, graph: record.graph, definition: { id: definition.id, name: definition.name, scope: definition.scope } }];
  });
}

export type DevelopmentTemplateLoopSelection = {
  developmentLoopVersionId?: string | null;
  releaseLoopVersionId?: string | null;
};

export function DevelopmentTemplateLoopPreviews({ template, loopVersions }: {
  template: DevelopmentTemplateLoopSelection;
  loopVersions: readonly DevelopmentTemplateLoopPreview[];
}) {
  const previews = [
    { role: "任务开发 Loop", id: template.developmentLoopVersionId },
    { role: "里程碑 Loop", id: template.releaseLoopVersionId },
  ].flatMap(({ role, id }) => {
    const version = loopVersions.find((candidate) => candidate.id === id && candidate.definition?.scope === "project");
    const graph = loopAuthoringGraphSchema.safeParse(version?.graph);
    return version && graph.success ? [{ role, version, flow: projectLoopGraphToFlow(graph.data) }] : [];
  });

  if (previews.length !== 2) return <p className="text-xs leading-5 text-[#57606a]">所选模板的已发布项目级 Loop 流程暂不可用。</p>;
  return <section className="grid gap-3 border border-[#d0d7de] p-3" aria-label="已选 Loop 流程预览">
    <h3 className="text-xs font-semibold text-[#24292f]">已选版本流程预览</h3>
    <div className="grid gap-3 lg:grid-cols-2">{previews.map(({ role, version, flow }) => <article key={version.id} className="min-w-0 border border-[#d0d7de] p-3">
      <h4 className="text-xs font-semibold text-[#24292f]">{role} · {version.definition?.name ?? "Loop"} · v{version.versionNumber} <code className="font-mono font-normal text-[#57606a]">{version.id}</code></h4>
      <ol className="mt-3 grid gap-2">{flow.map((step, index) => <li key={step.key} className="grid grid-cols-[1.5rem_minmax(0,1fr)] gap-2 text-sm"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-[#f6f8fa] text-xs font-semibold text-[#57606a]">{index + 1}</span><div className="min-w-0"><div className="font-medium text-[#24292f]">{step.label}</div>{step.detail ? <p className="mt-0.5 break-words text-xs leading-5 text-[#57606a]">{step.detail}</p> : null}{step.outcomes.length > 0 ? <p className="mt-1 text-xs text-[#57606a]">分支：{step.outcomes.join(" / ")}</p> : null}</div></li>)}</ol>
    </article>)}</div>
  </section>;
}

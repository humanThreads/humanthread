import type { WorkbenchProjectOverview } from "../../lib/workbench/workbench-projects";
import type { TaskCenterTemplatePreset } from "../../lib/workbench/workbench-task-center";

export function WorkbenchQuickCreateFormFields({
  projects = [],
  selectedProjectId,
  descriptionRows = 3,
  templatePreset,
}: {
  projects?: WorkbenchProjectOverview[];
  selectedProjectId?: string;
  descriptionRows?: number;
  templatePreset?: TaskCenterTemplatePreset;
}) {
  const acceptanceCriteriaDefault =
    templatePreset?.quickCreate.acceptanceCriteria.join("\n") ?? "";
  const requiredDocsDefault = templatePreset?.quickCreate.requiredDocs.join("\n") ?? "";
  const agentPrerequisitesDefault =
    templatePreset?.quickCreate.agentPrerequisites.join("\n") ?? "";

  return (
    <>
      <input
        type="text"
        name="title"
        required
        placeholder="事项标题"
        defaultValue={templatePreset?.quickCreate.titlePrefix ?? ""}
        className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm outline-none focus:border-[#0969da]"
      />
      <textarea
        name="description"
        rows={descriptionRows}
        placeholder="事项说明"
        defaultValue={templatePreset?.description ?? ""}
        className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm outline-none focus:border-[#0969da]"
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
          阶段
          <select
            name="phase"
            defaultValue={templatePreset?.quickCreate.phase ?? "确认需求"}
            className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
          >
            <option value="确认需求">确认需求</option>
            <option value="执行中">执行中</option>
            <option value="验证中">验证中</option>
            <option value="等待反馈">等待反馈</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
          优先级
          <select
            name="priority"
            defaultValue={templatePreset?.quickCreate.priority ?? "medium"}
            className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
          >
            <option value="high">高</option>
            <option value="medium">中</option>
            <option value="low">低</option>
          </select>
        </label>
      </div>
      <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
        截止时间
        <input
          type="datetime-local"
          name="dueAt"
          className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
        />
      </label>
      {projects.length > 0 ? (
        <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
          所属项目
          <select
            name="projectId"
            defaultValue={selectedProjectId ?? projects[0]?.id}
            className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
          >
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
        验收标准
        <textarea
          name="acceptanceCriteria"
          rows={3}
          placeholder="每行一条，创建后会写入任务说明"
          defaultValue={acceptanceCriteriaDefault}
          className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
        所需文档
        <textarea
          name="requiredDocs"
          rows={2}
          placeholder="每行一条，创建后会写入任务说明"
          defaultValue={requiredDocsDefault}
          className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
        />
      </label>
      <label className="grid gap-1 text-sm font-semibold text-[#24292f]">
        Agent 前置条件
        <textarea
          name="agentPrerequisites"
          rows={2}
          placeholder="每行一条，创建后会写入任务说明"
          defaultValue={agentPrerequisitesDefault}
          className="rounded-md border border-[#d0d7de] bg-white px-3 py-2 text-sm font-normal outline-none focus:border-[#0969da]"
        />
      </label>
      <div className="text-xs leading-5 text-[#57606a]">
        阶段、优先级、截止时间和验收标准会一起写入任务说明，后续可在任务详情继续补充。
      </div>
      <label className="flex items-center gap-2 text-sm text-[#57606a]">
        <input type="checkbox" name="startImmediately" className="h-4 w-4" />
        创建后立即开始第一阶段
      </label>
    </>
  );
}

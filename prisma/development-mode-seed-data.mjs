import { createHash } from "node:crypto";

export const PLATFORM_LOOP_SPACE_ID = "space:system:humanthread";
export const PLATFORM_LOOP_SCOPE = "project";
export const PLATFORM_LOOP_ORIGIN = "platform";

export const TASK_DEVELOPMENT_GRAPH = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 5, maxRepeatCount: 1 },
  nodes: [
    { key: "start", type: "start", label: "Start" },
    {
      key: "prepare_task_branch",
      type: "agent_action",
      label: "Prepare task branch",
      executionTarget: "local",
      promptTemplate: "Create or reuse the isolated {year}-{shortId} task branch and worktree from staging.",
    },
    {
      key: "develop",
      type: "agent_action",
      label: "Develop",
      executionTarget: "local",
      promptTemplate: "Implement the Task using repository-local constraints and commit only to the task branch.",
    },
    {
      key: "verify_and_push",
      type: "agent_action",
      label: "Verify and push task branch",
      executionTarget: "local",
      promptTemplate: "Run Task tests, write the test report, and push only the task branch. Never update staging.",
    },
    { key: "end", type: "end", label: "Task branch ready" },
  ],
  edges: [
    { id: "task_start_prepare", source: "start", target: "prepare_task_branch", kind: "normal", outcome: "success" },
    { id: "task_prepare_develop", source: "prepare_task_branch", target: "develop", kind: "normal", outcome: "success" },
    { id: "task_develop_verify", source: "develop", target: "verify_and_push", kind: "normal", outcome: "success" },
    { id: "task_verify_end", source: "verify_and_push", target: "end", kind: "normal", outcome: "success" },
  ],
};

// v1 remains immutable for existing parent Runs. v2 delegates the actual Task workflow to a child Loop.
export const TASK_DEVELOPMENT_GRAPH_V2 = {
  ...TASK_DEVELOPMENT_GRAPH,
  nodes: TASK_DEVELOPMENT_GRAPH.nodes.map((node) => node.key === "develop"
    ? {
        key: "develop",
        type: "platform_action",
        label: "Develop",
        executionTarget: "platform",
        action: "task_loop.invoke",
      }
    : node),
};

// Published graphs are immutable. v3 makes the task Loop identity part of the
// parent snapshot instead of discovering a binding when Develop starts.
export const TASK_DEVELOPMENT_GRAPH_V3 = {
  ...TASK_DEVELOPMENT_GRAPH,
  nodes: TASK_DEVELOPMENT_GRAPH.nodes.map((node) => node.key === "develop"
    ? {
        key: "develop",
        type: "subloop_call",
        label: "Develop",
        executionTarget: "platform",
        targetLoopDefinitionId: "loop_definition_gelsang_project_v1",
        targetLoopVersionId: "loop_version_gelsang_project_v1",
        inputMapping: {},
        terminalOutcomeMapping: { success: "success", failure: "failure" },
      }
    : node),
};

export const TASK_DEVELOPMENT_GRAPH_V4 = {
  ...TASK_DEVELOPMENT_GRAPH,
  schemaVersion: 2,
  routingMetadata: {
    prepare_task_branch: { responsibility: "Create or reuse the isolated Task branch and worktree, then verify the Task input and branch scope." },
    develop: { responsibility: "Run the current Gelsang task Loop and preserve its terminal result as the Task development outcome." },
    verify_and_push: { responsibility: "Verify the completed Task branch, record the required evidence, and push only that branch." },
  },
  nodes: TASK_DEVELOPMENT_GRAPH.nodes.map((node) => node.key === "develop"
    ? {
        key: "develop",
        type: "subloop_call",
        label: "Develop",
        executionTarget: "platform",
        targetLoopDefinitionId: "loop_definition_gelsang_project_v1",
        targetLoopVersionId: "loop_version_gelsang_project_v3",
        inputMapping: {},
        terminalOutcomeMapping: { success: "success", failure: "failure" },
      }
    : node),
};

export const MILESTONE_RELEASE_GRAPH = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 8, maxRepeatCount: 2 },
  nodes: [
    { key: "start", type: "start", label: "Start" },
    {
      key: "snapshot_release",
      type: "platform_action",
      label: "Snapshot release candidate",
      executionTarget: "platform",
      action: "milestone.release.snapshot",
    },
    {
      key: "integrate_staging",
      type: "agent_action",
      label: "Integrate staging",
      executionTarget: "local",
      promptTemplate: "Merge every snapshotted Task branch into staging in deterministic order, resolving conflicts from Task documents, knowledge, and test reports.",
    },
    {
      key: "business_test",
      type: "agent_action",
      label: "Run business tests",
      executionTarget: "local",
      promptTemplate: "Run the complete milestone business test suite and verify every function listed in every Task test report.",
    },
    {
      key: "production_approval",
      type: "human_gate",
      label: "Approve production release",
      executionTarget: "platform",
      prompt: "Approve the exact staging candidate and test-evidence fingerprint for production release.",
    },
    {
      key: "release_production",
      type: "agent_action",
      label: "Release production",
      executionTarget: "local",
      promptTemplate: "Merge the approved staging candidate into the production branch without force-push, then build, tag, deploy, and reconcile results idempotently.",
    },
    { key: "released", type: "end", label: "Released" },
    { key: "rejected", type: "end", label: "Rejected" },
  ],
  edges: [
    { id: "release_start_snapshot", source: "start", target: "snapshot_release", kind: "normal", outcome: "success" },
    { id: "release_snapshot_integrate", source: "snapshot_release", target: "integrate_staging", kind: "normal", outcome: "success" },
    { id: "release_integrate_test", source: "integrate_staging", target: "business_test", kind: "normal", outcome: "success" },
    { id: "release_test_approval", source: "business_test", target: "production_approval", kind: "normal", outcome: "success" },
    { id: "release_approval_pass", source: "production_approval", target: "release_production", kind: "normal", outcome: "pass" },
    { id: "release_approval_reject", source: "production_approval", target: "rejected", kind: "normal", outcome: "reject" },
    { id: "release_production_end", source: "release_production", target: "released", kind: "normal", outcome: "success" },
  ],
};

export const MILESTONE_RELEASE_GRAPH_V2 = {
  ...MILESTONE_RELEASE_GRAPH,
  schemaVersion: 2,
  routingMetadata: {
    snapshot_release: { responsibility: "Snapshot the milestone release candidate and provide the immutable integration input." },
    integrate_staging: { responsibility: "Integrate the snapshotted Task branches into staging and preserve conflict-resolution evidence." },
    business_test: { responsibility: "Run the milestone business verification and route failures back to integration." },
    production_approval: { responsibility: "Review the exact staging candidate and test evidence, then approve or reject production release." },
    release_production: { responsibility: "Push the approved production source, verify the remote commit, and complete the production release." },
  },
  nodes: MILESTONE_RELEASE_GRAPH.nodes.map((node) => node.key === "release_production"
    ? {
        ...node,
        promptTemplate: "Merge the approved staging candidate into the configured production branch, push origin/<production branch>, verify HEAD equals the pushed remote commit, then build, tag, deploy, and reconcile results idempotently.",
      }
    : node),
};

export const GELSANG_PROJECT_LOOP_GRAPH = {
  schemaVersion: 1,
  inputSchema: { type: "object" },
  outputSchema: { type: "object" },
  limits: { maxStages: 16, maxRepeatCount: 2 },
  nodes: [
    { key: "start", type: "start", label: "开始" },
    { key: "create_worktree", type: "agent_action", label: "创建 worktree", executionTarget: "local", promptTemplate: "Create a clean worktree for this Task before any repository changes." },
    { key: "get_requirement", type: "agent_action", label: "使用 MCP 获取需求", executionTarget: "local", promptTemplate: "Use HumanThread MCP to load the Task requirements and related project context." },
    {
      key: "analyze_requirement",
      type: "agent_action",
      label: "分析需求",
      executionTarget: "local",
      promptTemplate: "Analyze the requirement and identify ambiguity, risks, and areas requiring human input.",
      interactionPolicy: {
        kind: "requirement_conversation",
        replyRoles: ["task_collaborator", "task_assignee", "task_creator", "project_admin"],
        confirmRoles: ["task_assignee", "task_creator", "project_admin"],
        structuredFields: [],
      },
    },
    { key: "confirm_requirement", type: "human_gate", label: "确认需求", executionTarget: "platform", prompt: "Answer the requirement questions, or confirm that the proposed interpretation is correct." },
    { key: "write_prd", type: "agent_action", label: "生成需求 PRD", executionTarget: "local", promptTemplate: "Write the confirmed PRD and push it to the Task documents." },
    { key: "write_plan", type: "agent_action", label: "生成开发计划", executionTarget: "local", promptTemplate: "Write the implementation plan and push it to the Task documents." },
    { key: "develop", type: "agent_action", label: "进行开发", executionTarget: "local", promptTemplate: "Implement the Task in the isolated worktree and commit only to the Task branch." },
    { key: "test", type: "agent_action", label: "自动化测试", executionTarget: "local", promptTemplate: "Run the repository test, lint, typecheck, and build checks required by the Task." },
    { key: "business_test", type: "agent_action", label: "实际测试", executionTarget: "local", promptTemplate: "Run the business-facing verification flow and record the result." },
    { key: "upload_screenshot", type: "agent_action", label: "上传测试截图", executionTarget: "local", promptTemplate: "Upload screenshots and other test evidence to the Task." },
    { key: "push_branch", type: "agent_action", label: "推送任务分支", executionTarget: "local", promptTemplate: "Push the Task branch. Do not merge it into staging or production." },
    { key: "cleanup", type: "agent_action", label: "清理 worktree 和缓存", executionTarget: "local", promptTemplate: "Remove this run's worktree and package/build cache after all evidence is persisted." },
    { key: "end", type: "end", label: "任务分支已就绪" },
  ],
  edges: [
    ["start", "create_worktree"],
    ["create_worktree", "get_requirement"],
    ["get_requirement", "analyze_requirement"],
    ["analyze_requirement", "confirm_requirement"],
    ["confirm_requirement", "write_prd"],
    ["write_prd", "write_plan"],
    ["write_plan", "develop"],
    ["develop", "test"],
    ["test", "business_test"],
    ["business_test", "upload_screenshot"],
    ["upload_screenshot", "push_branch"],
    ["push_branch", "cleanup"],
    ["cleanup", "end"],
  ].map(([source, target]) => ({ id: `gelsang_${source}_${target}`, source, target, kind: "normal", outcome: "success" }))
    .concat([
      // A downstream stage may discover that an upstream artifact belongs to
      // a different task. Recovery remains inside this published graph.
      { id: "gelsang_develop_write_prd_rework", source: "develop", target: "write_prd", kind: "feedback", outcome: "rework", maxTraversals: 2 },
      { id: "gelsang_develop_write_plan_rework", source: "develop", target: "write_plan", kind: "feedback", outcome: "rework", maxTraversals: 2 },
    ]),
};

export const GELSANG_PROJECT_LOOP_GRAPH_V2 = {
  ...GELSANG_PROJECT_LOOP_GRAPH,
  schemaVersion: 2,
  routingMetadata: {
    create_worktree: { responsibility: "Create the isolated worktree for this Task before making repository changes." },
    get_requirement: { responsibility: "Load the authoritative Task requirements and related Project context through HumanThread MCP." },
    analyze_requirement: { responsibility: "Analyze requirement completeness and risks, requesting human input when a decision is required." },
    confirm_requirement: { responsibility: "Confirm the interpreted requirements and record the human decision before implementation planning." },
    write_prd: { responsibility: "Write the confirmed requirements as the Task PRD and persist its reviewable evidence." },
    write_plan: { responsibility: "Turn the confirmed PRD into an executable implementation and verification plan." },
    develop: { responsibility: "Implement the approved Task in the isolated worktree and keep changes on the Task branch." },
    test: { responsibility: "Run the required automated tests, static checks, and builds, recording actionable failure evidence." },
    business_test: { responsibility: "Verify the implemented behavior through the real business flow and record the outcome." },
    upload_screenshot: { responsibility: "Upload the screenshots and other evidence needed to review the completed business verification." },
    push_branch: { responsibility: "Commit and push only the verified Task branch without merging into staging or production." },
    cleanup: { responsibility: "Remove the Task worktree and build cache after preserving all commits and verification evidence." },
  },
};

export const PLATFORM_LOOP_DEFINITIONS = [
  {
    definitionId: "loop_definition_gelsang_project_v1",
    versionId: "loop_version_gelsang_project_v1",
    latest: false,
    spaceId: PLATFORM_LOOP_SPACE_ID,
    scope: "task",
    origin: PLATFORM_LOOP_ORIGIN,
    ownerUserId: "user_owner",
    name: "Gelsang Project Loop",
    description: "任务需求确认、开发、测试、证据上传、任务分支推送和清理。",
    graph: {
      ...GELSANG_PROJECT_LOOP_GRAPH,
      nodes: GELSANG_PROJECT_LOOP_GRAPH.nodes.map((node) => node.key === "analyze_requirement"
        ? Object.fromEntries(Object.entries(node).filter(([key]) => key !== "interactionPolicy"))
        : node),
      edges: GELSANG_PROJECT_LOOP_GRAPH.edges.filter((edge) => edge.kind !== "feedback"),
    },
    maxTransitions: 42,
  },
  {
    definitionId: "loop_definition_gelsang_project_v1",
    versionId: "loop_version_gelsang_project_v3",
    versionNumber: 3,
    latest: true,
    previousLatestVersionIds: ["loop_version_gelsang_project_v1", "loop_version_4b3f3bd997f2b0eadff784f1d315fac0e463f526a937017620356d0d3c6e1659"],
    spaceId: PLATFORM_LOOP_SPACE_ID,
    scope: "task",
    origin: PLATFORM_LOOP_ORIGIN,
    ownerUserId: "user_owner",
    name: "Gelsang Project Loop",
    description: "任务需求确认、开发、测试、证据上传、任务分支推送和清理。",
    graph: GELSANG_PROJECT_LOOP_GRAPH_V2,
    maxTransitions: 42,
  },
  {
    definitionId: "loop_definition_branch_task_v2",
    versionId: "loop_version_branch_task_v2",
    versionNumber: 1,
    latest: false,
    spaceId: PLATFORM_LOOP_SPACE_ID,
    scope: PLATFORM_LOOP_SCOPE,
    origin: PLATFORM_LOOP_ORIGIN,
    ownerUserId: "user_owner",
    name: "Branch Development: Task Development",
    description: "Prepare the Task branch and invoke the configured task-scoped Loop at Develop.",
    graph: TASK_DEVELOPMENT_GRAPH_V2,
    maxTransitions: 10,
  },
  {
    definitionId: "loop_definition_branch_task_v2",
    versionId: "loop_version_branch_task_v3",
    versionNumber: 2,
    latest: false,
    previousLatestVersionIds: ["loop_version_branch_task_v2"],
    spaceId: PLATFORM_LOOP_SPACE_ID,
    scope: PLATFORM_LOOP_SCOPE,
    origin: PLATFORM_LOOP_ORIGIN,
    ownerUserId: "user_owner",
    name: "Branch Development: Task Development",
    description: "Prepare the Task branch and invoke the pinned task-scoped Loop at Develop.",
    graph: TASK_DEVELOPMENT_GRAPH_V3,
    maxTransitions: 10,
  },
  {
    definitionId: "loop_definition_branch_task_v2",
    versionId: "loop_version_branch_task_v4",
    versionNumber: 4,
    latest: true,
    previousLatestVersionIds: ["loop_version_branch_task_v3", "loop_version_1371f7b55b9964ecee539c40b247fe6b43b6242be44a7a50e06c05097aada64b"],
    spaceId: PLATFORM_LOOP_SPACE_ID,
    scope: PLATFORM_LOOP_SCOPE,
    origin: PLATFORM_LOOP_ORIGIN,
    ownerUserId: "user_owner",
    name: "Branch Development: Task Development",
    description: "Prepare the Task branch and invoke the recoverable pinned task-scoped Loop at Develop.",
    graph: TASK_DEVELOPMENT_GRAPH_V4,
    maxTransitions: 10,
  },
  {
    definitionId: "loop_definition_branch_release_v2",
    versionId: "loop_version_branch_release_v2",
    spaceId: PLATFORM_LOOP_SPACE_ID,
    scope: PLATFORM_LOOP_SCOPE,
    origin: PLATFORM_LOOP_ORIGIN,
    ownerUserId: "user_owner",
    name: "Branch Development: Milestone Release",
    description: "Integrate, retest, verify the pushed production source, and release a milestone.",
    graph: MILESTONE_RELEASE_GRAPH_V2,
    maxTransitions: 24,
  },
];

export function buildPlatformLoopVersionWriteData(loop) {
  return {
    versionNumber: loop.versionNumber ?? 1,
    graphSchemaVersion: loop.graph.schemaVersion,
    graph: loop.graph,
    maxStages: loop.graph.limits.maxStages,
    maxRepeatCount: loop.graph.limits.maxRepeatCount,
    platformMaxTransitions: loop.maxTransitions,
    checksum: createHash("sha256").update(JSON.stringify(loop.graph)).digest("hex"),
    publishedByUserId: loop.ownerUserId,
    status: "published",
  };
}

export const BRANCH_DEVELOPMENT_TEMPLATE = {
  id: "project_template_branch_development_v1",
  key: "branch-development",
  name: "分支开发",
  version: 1,
  status: "published",
  spaceId: PLATFORM_LOOP_SPACE_ID,
  origin: "platform",
  kind: "branch-development",
  description: "任务分支开发和里程碑发布",
  createdByUserId: "user_owner",
  sourceTemplateId: null,
  revision: 1,
  projectConfigSchema: {
    type: "object",
    required: ["productionBranch", "stagingBranch", "releaseAgentProfileId"],
    properties: {
      productionBranch: { type: "string" },
      stagingBranch: { type: "string" },
      releaseAgentProfileId: { type: "string" },
    },
  },
  taskFieldSchema: {
    type: "object",
    required: ["taskBranch"],
    properties: { taskBranch: { type: "string", pattern: "^[0-9]{4}-[A-Z0-9]+$" } },
  },
  developmentLoopVersionId: "loop_version_branch_task_v1",
  releaseLoopVersionId: "loop_version_branch_release_v1",
  triggerPolicy: { releaseTriggers: ["milestone.release_ready", "manual"] },
  executionPolicy: {
    taskBranchPattern: "{year}-{shortId}",
    taskBranchBase: "staging",
    taskBranchCreation: "on_first_execution",
    integrationMode: "local_merge_test_push",
    productionApprovalRequired: true,
  },
};

export const BRANCH_DEVELOPMENT_TEMPLATE_V2 = {
  ...BRANCH_DEVELOPMENT_TEMPLATE,
  id: "project_template_branch_development_v2",
  version: 2,
  revision: 1,
  sourceTemplateId: null,
  description: "任务分支开发和里程碑发布（Develop 嵌入任务级 Loop）",
  developmentLoopVersionId: "loop_version_branch_task_v2",
  releaseLoopVersionId: "loop_version_branch_release_v2",
  executionPolicy: {
    ...BRANCH_DEVELOPMENT_TEMPLATE.executionPolicy,
    productionSourceVerification: "merge_push_remote_head_before_build",
  },
};

export const BRANCH_DEVELOPMENT_TEMPLATE_V3 = {
  ...BRANCH_DEVELOPMENT_TEMPLATE_V2,
  id: "project_template_branch_development_v3",
  version: 3,
  description: "任务分支开发和里程碑发布（Develop 固定引用任务级 Loop）",
  developmentLoopVersionId: "loop_version_branch_task_v3",
};

export const BRANCH_DEVELOPMENT_TEMPLATE_V4 = {
  ...BRANCH_DEVELOPMENT_TEMPLATE_V3,
  id: "project_template_branch_development_v4",
  version: 4,
  description: "任务分支开发和里程碑发布（Develop 固定引用可恢复任务级 Loop）",
  developmentLoopVersionId: "loop_version_branch_task_v4",
};

export const BRANCH_DEVELOPMENT_TEMPLATES = [
  BRANCH_DEVELOPMENT_TEMPLATE_V4,
];

export function planBranchDevelopmentV3Upgrade(project) {
  if (project.developmentTemplateKey !== "branch-development" || project.developmentTemplateVersion !== 2) return null;
  const binding = project.loopBindings?.find((candidate) => (
    candidate.bindingRole === "task_development"
    && candidate.loopDefinitionId === "loop_definition_branch_task_v2"
    && candidate.activeVersionId === "loop_version_branch_task_v2"
  ));
  return binding ? { projectId: project.id, bindingId: binding.id } : null;
}

export async function applyBranchDevelopmentV3Upgrade(tx, upgrade) {
  const binding = await tx.projectLoopBinding.updateMany({
    where: {
      id: upgrade.bindingId,
      projectId: upgrade.projectId,
      bindingRole: "task_development",
      loopDefinitionId: "loop_definition_branch_task_v2",
      activeVersionId: "loop_version_branch_task_v2",
    },
    data: { activeVersionId: "loop_version_branch_task_v3", version: { increment: 1 } },
  });
  if (binding.count !== 1) throw new Error(`Branch-development binding changed during v3 upgrade: ${upgrade.bindingId}`);
  const project = await tx.project.updateMany({
    where: {
      id: upgrade.projectId,
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 2,
    },
    data: { developmentTemplateVersion: 3, version: { increment: 1 } },
  });
  if (project.count !== 1) throw new Error(`Branch-development Project changed during v3 upgrade: ${upgrade.projectId}`);
}

const BRANCH_DEVELOPMENT_V3_VERSION_IDS = [
  "loop_version_branch_task_v3",
  "loop_version_1371f7b55b9964ecee539c40b247fe6b43b6242be44a7a50e06c05097aada64b",
];

export function planBranchDevelopmentV4Upgrade(project) {
  if (project.developmentTemplateKey !== "branch-development" || project.developmentTemplateVersion !== 3) return null;
  const binding = project.loopBindings?.find((candidate) => (
    candidate.bindingRole === "task_development"
    && candidate.loopDefinitionId === "loop_definition_branch_task_v2"
    && BRANCH_DEVELOPMENT_V3_VERSION_IDS.includes(candidate.activeVersionId)
  ));
  return binding ? { projectId: project.id, bindingId: binding.id, activeVersionId: binding.activeVersionId } : null;
}

export async function applyBranchDevelopmentV4Upgrade(tx, upgrade) {
  const binding = await tx.projectLoopBinding.updateMany({
    where: {
      id: upgrade.bindingId,
      projectId: upgrade.projectId,
      bindingRole: "task_development",
      loopDefinitionId: "loop_definition_branch_task_v2",
      activeVersionId: upgrade.activeVersionId,
    },
    data: { activeVersionId: "loop_version_branch_task_v4", version: { increment: 1 } },
  });
  if (binding.count !== 1) throw new Error(`Branch-development binding changed during v4 upgrade: ${upgrade.bindingId}`);
  const project = await tx.project.updateMany({
    where: {
      id: upgrade.projectId,
      developmentTemplateKey: "branch-development",
      developmentTemplateVersion: 3,
    },
    data: { developmentTemplateVersion: 4, version: { increment: 1 } },
  });
  if (project.count !== 1) throw new Error(`Branch-development Project changed during v4 upgrade: ${upgrade.projectId}`);
}

export async function upgradeGelsangBindingsToV3(tx) {
  return tx.projectLoopBinding.updateMany({
    where: {
      loopDefinitionId: "loop_definition_gelsang_project_v1",
      activeVersionId: {
        in: [
          "loop_version_gelsang_project_v1",
          "loop_version_4b3f3bd997f2b0eadff784f1d315fac0e463f526a937017620356d0d3c6e1659",
        ],
      },
    },
    data: { activeVersionId: "loop_version_gelsang_project_v3", version: { increment: 1 } },
  });
}

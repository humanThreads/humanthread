import {
  projectLoopLockV2Schema,
  projectLoopManifestV2Schema,
  type LoopSyncDiagnostic,
  type ProjectLoopLockV2,
  type ProjectLoopManifestV2,
} from "./contracts";

type StageMetadata = {
  storageId: string;
  loopId: string;
  subloopId: string;
  label: string;
  responsibility: string;
};

function requiresLocalStage(node: { type: string; executionTarget?: string }): boolean {
  return node.type === "agent_action" && (node.executionTarget === "local" || node.executionTarget === "either");
}

function stableNodeId(node: { key: string; nodeId?: string | undefined }): string {
  return node.nodeId ?? node.key;
}

function stageOwners(manifest: ProjectLoopManifestV2): Map<string, Set<string>> {
  const owners = new Map<string, Set<string>>();
  for (const loop of manifest.publishedLoops) {
    for (const version of loop.publishedVersions) {
      for (const node of version.graph.nodes) {
        if (!requiresLocalStage(node)) continue;
        const subloopId = stableNodeId(node);
        const values = owners.get(subloopId) ?? new Set<string>();
        values.add(loop.loopDefinitionId);
        owners.set(subloopId, values);
      }
    }
  }
  return owners;
}

function storageId(owners: Map<string, Set<string>>, loopId: string, subloopId: string): string {
  return (owners.get(subloopId)?.size ?? 0) > 1 ? `${loopId}::${subloopId}` : subloopId;
}

export function resolveReachableStageMetadata(manifestInput: ProjectLoopManifestV2): {
  stages: StageMetadata[];
  issues: LoopSyncDiagnostic[];
} {
  const manifest = projectLoopManifestV2Schema.parse(manifestInput);
  const owners = stageOwners(manifest);
  const versions = new Map(manifest.publishedLoops.flatMap((loop) => loop.publishedVersions
    .map((version) => [version.loopVersionId, { loop, version }] as const)));
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byStorageId = new Map<string, StageMetadata>();
  const issues: LoopSyncDiagnostic[] = [];

  const visit = (loopId: string, versionId: string): void => {
    if (visiting.has(versionId)) {
      issues.push({ code: "active_subloop_unreachable", loopId, message: `SubLoop cycle detected at ${versionId}` });
      return;
    }
    if (visited.has(versionId)) return;
    const selected = versions.get(versionId);
    if (!selected || selected.loop.loopDefinitionId !== loopId) {
      issues.push({ code: "active_subloop_unreachable", loopId, message: `Published Loop version is unavailable: ${versionId}` });
      return;
    }
    visiting.add(versionId);
    for (const node of selected.version.graph.nodes) {
      if (requiresLocalStage(node)) {
        const subloopId = stableNodeId(node);
        const key = storageId(owners, loopId, subloopId);
        byStorageId.set(key, {
          storageId: key,
          loopId,
          subloopId,
          label: node.label,
          responsibility: "responsibility" in node ? node.responsibility : "",
        });
      }
      if (node.type === "subloop_call") visit(node.targetLoopDefinitionId, node.targetLoopVersionId);
    }
    visiting.delete(versionId);
    visited.add(versionId);
  };

  for (const binding of manifest.projectBindings) {
    if (binding.status !== "enabled") continue;
    visit(binding.loopDefinitionId, binding.activeVersionId);
  }
  return { stages: [...byStorageId.values()].sort((left, right) => left.storageId.localeCompare(right.storageId)), issues };
}

function tableCell(value: string): string {
  return value.replace(/\|/gu, "\\|").replace(/\r?\n/gu, " ");
}

export function renderConfigurationGuide(input: {
  manifest: ProjectLoopManifestV2;
  lock: ProjectLoopLockV2;
}): string {
  const manifest = projectLoopManifestV2Schema.parse(input.manifest);
  const lock = projectLoopLockV2Schema.parse(input.lock);
  const reachable = resolveReachableStageMetadata(manifest);
  const rows = reachable.stages.map((stage) => {
    const entry = lock.subloops[stage.storageId]
      ?? Object.values(lock.subloops).find((candidate) => candidate.stableId === stage.subloopId && candidate.parentLoopId === stage.loopId);
    return `| ${tableCell(stage.loopId)} | ${tableCell(stage.subloopId)} | ${tableCell(stage.responsibility)} | ${tableCell(entry?.path ?? "未初始化")} | ${entry?.state ?? "missing"} |`;
  });
  return [
    "# HumanThread 项目 Loop 配置向导",
    "",
    "> 此文件由 `ht init` 根据平台流程生成。项目规则、Prompt、凭据和业务事实必须保留在仓库中，不会上传到平台。",
    "",
    `- Project: \`${manifest.projectId}\``,
    `- Catalog digest: \`${manifest.catalogVersion}\``,
    "",
    "## 1. 全局约束",
    "",
    "先在仓库根部维护项目全局约束，并确保 Codex 与 Claude 都能发现 `.agents/skills/`。不要在平台、`agents.yaml` 或生成向导中保存凭据。",
    "",
    "## 2. 本地规则整理引导",
    "",
    "初始化只创建所选 Loop 的结构和空白 Stage Package。请在仓库内完成以下项目约定，正文不会上传到平台：",
    "",
    "1. 在 `AGENTS.md` 或项目既有指令文件中写全局执行规则、测试与验收要求。",
    "2. 在每个已初始化 Stage 的 `rules/`、`prompts/`、`resources/`、`schemas/`、`templates/` 中补齐该 Loop 的具体约定。",
    "3. 在 `.agents/skills/<skill-key>/SKILL.md` 维护项目 Skill，并在 Stage 的 `skills/index.yaml` 选择需要的 Skill。",
    "4. 在项目受 Git 忽略的本地配置中维护 MCP 与凭据；只在规则中说明变量名和脱敏校验结果。",
    "5. 使用 `ht doctor` 检查本地文件完整性，确认后再将对应 `stage.yaml` 的 `configured` 设为 `true`。",
    "",
    "## 3. 已启用且可达的 Stage",
    "",
    "只有下表中的 Stage 会阻断当前项目执行；未绑定、不可达或 orphaned Stage 不会被触发。",
    "",
    "| Loop | SubLoop | 平台职责 | 本地路径 | 当前状态 |",
    "|---|---|---|---|---|",
    ...(rows.length > 0 ? rows : ["| - | - | 当前没有可达 Stage | - | - |"]),
    "",
    "## 4. Stage Package 配置顺序",
    "",
    "1. 在 `stage.yaml` 中确定业务目标、输入边界、Checklist 和质量门禁。",
    "2. 在 `schemas/` 定义控制面结果和关键业务产物结构。",
    "3. 在 `templates/` 固定业务产物骨架。",
    "4. 在 `rules/` 写必须、禁止和仅当等强约束。",
    "5. 在 `resources/` 放权威枚举、映射和参考事实。",
    "6. 在 `prompts/` 编排执行步骤，不复制规则和 Schema 全文。",
    "7. 在 `agents.yaml` 只配置阶段执行角色和恢复策略。",
    "",
    "## 5. Skill 选择",
    "",
    "Skill 的唯一权威源是 `.agents/skills/<skill-key>/SKILL.md`。Stage 通过 `skills/index.yaml` 选择：",
    "",
    "- `mode: all`：加载所有有效 Skill。",
    "- `mode: none`：不加载 Skill。",
    "- `mode: include`：只加载 `skills` 数组列出的 Skill。",
    "",
    "## 6. `configured` 检查表",
    "",
    "- [ ] `businessGoal` 是可验证的阶段结果。",
    "- [ ] 输入、写权限、允许命令和阻断路径采用最小范围。",
    "- [ ] 每个 Checklist 项都有证据和复用策略。",
    "- [ ] 成功所需产物已进入质量门禁。",
    "- [ ] Prompt、Rules、Resources、Schemas、Skills、Templates 六类目录齐全。",
    "- [ ] 完成上述配置后将 `stage.yaml` 的 `configured` 设为 `true`。",
    "",
    "## 7. Doctor 与修复",
    "",
    "运行 `ht doctor` 检查可达 Stage。缺失 Stage 使用显式 repair；被修改的 v1 节点必须使用显式 migrate，`ht init` 不会覆盖项目文件。",
    "",
  ].join("\n");
}

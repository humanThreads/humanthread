# 项目 Loop 工作区契约

## 目标

项目设置与 Loop 配置位于同一个项目工作区，通过 `overview`、`settings`、`loops` 三个 Tab 访问。项目 Loop 是项目级流程，可多选；任务 Loop 是项目 Loop 的子流程资源，也可多选。模板应用只复制配置快照，项目创建后可以独立调整。

## 配置模型

项目 `loopGroupConfig` 保存以下字段：

- `projectLoopVersionIds`：已选项目 Loop 版本。
- `defaultProjectLoopVersionId`：默认里程碑 Loop 版本，必须来自项目 Loop 列表。
- `taskLoopVersionIds`：已选任务 Loop 版本。
- `defaultTaskLoopVersionId`：默认任务 Loop 版本，必须来自项目 Loop 列表。它表示承担任务阶段的项目级根流程，不是任务级 SubLoop。
- `projectLoopNodeTaskLoopIds`：项目 Loop 版本 ID -> 稳定节点 key -> 任务 Loop 版本 ID；只允许引用已选项目 Loop 和任务 Loop。
- `selectedPresetKeys`、`defaultPresetKey`：模板预设快照信息。

节点映射使用项目 Loop 版本 ID 和节点 key，不使用节点展示别名，避免别名修改导致配置漂移。取消项目 Loop 或任务 Loop 时，界面会同步清理对应的节点映射。

## 保存与并发

项目 Loop Tab 的“保存项目 Loop 配置”调用：

```text
PATCH /api/projects/{projectId}
{
  "commandId": "<命令标识>",
  "expectedVersion": 2,
  "loopGroupConfig": { ... }
}
```

服务端使用共享 `projectLoopGroupConfigSchema` 校验配置，要求项目版本与 `expectedVersion` 一致；保存成功后项目版本递增。版本冲突返回 `409`，客户端应刷新项目后重试。该操作只保存配置，不创建 Loop Run。

## 页面行为

项目 `?tab=loops` 显示：

1. 项目 Loop 列表，并在同一列表中分别选择默认任务 Loop和默认里程碑 Loop；两个默认角色使用不同图案和文字说明；
2. 项目 Loop 节点到任务 Loop 的下拉映射；
3. 任务 Loop 列表，仅提供多选，不提供默认单选；
4. 现有版本绑定、Worker 资源、授权与流程预览。

项目页不再额外渲染“项目级 Loop 与任务级 Loop 映射”或“可用任务级 Loop”旧版重复区；项目 Loop、节点映射和任务 Loop 统一由上述配置区管理，避免同一配置出现两套入口。

旧的 `settings=1` 参数和 `/projects/{id}/loops` 入口继续兼容，并归一到统一工作区。

## 任务启动选择契约

项目 Loop 配置保存后，任务启动不再固定读取唯一的 `task_development` 绑定，而是读取项目当前 `projectLoopVersionIds` 中处于启用状态的项目级绑定。`defaultTaskLoopVersionId` 只决定界面预选值，不限制用户为本次任务选择其他已配置的项目 Loop；`milestone_release` 绑定不能作为任务执行根流程。

启动请求通过 `bindingId` 显式选择 Loop。服务端必须校验绑定所属项目、启用状态、Loop 作用域和项目保存的 Loop 组范围，并在创建 Run 时冻结对应版本。未提供 `bindingId` 的旧客户端继续走 `task_development` 兼容路径。

任务分支不是所有 Loop 的强制前提。只有项目明确使用 `branch-development` 开发模板时才在首次执行分配任务分支；其他模式使用 `taskBranch=null` 创建 Run。已有任务分支继续复用，直接调用任务分支命令时仍校验分支开发模式。

任务列表、看板和日历的任务链接统一进入 `/tasks/{taskId}` 独立页面。页面右侧是唯一启动区，正文 Loop Tab 只承载运行监控和人工介入。

## 验收证据

- 项目 Loop 组件测试：`pnpm --filter @humanthread/web exec vitest run src/app/components/loops/project-loop-bindings.test.tsx`，1 个测试文件、26 个测试通过；覆盖旧版重复区不再出现、两个默认单选均位于项目 Loop 列表、任务 Loop 列表无默认单选及 `subloop_call` 映射。
- 项目命令测试：覆盖 `loopGroupConfig` 保存、项目版本递增和节点映射透传。
- Web 全量测试：`pnpm --filter @humanthread/web test`，405 个测试文件、1778 个测试通过。
- Shared 全量测试：20 个测试文件、244 个断言通过。
- `pnpm --filter @humanthread/web typecheck` 通过。
- `pnpm --filter @humanthread/web lint` 通过，0 error；仅保留既有 warning。
- `git diff --check` 通过。

本次修正移除了项目页旧版重复展示，保留与模板一致的统一 Loop 配置结构；补充了两个默认角色归属、`subloop_call` 映射过滤和项目设置入口文案。本次未触发生产发布。

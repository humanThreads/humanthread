# Schema 与迁移

Schema 唯一入口为 `prisma/schema.prisma`。仓库当前使用 `prisma db push` 应用结构变更，不维护 `prisma/migrations` 迁移目录；部署时的数据回填脚本与 Schema 变更分开执行。

## 标识与约束

- 新建表的主键、外键以及 `*_id` 字段统一使用 32 位小写十六进制 MD5，数据库列类型为 `CHAR(32)`。
- `knowledgeDigest(...parts)` 将参数以 `\0` 连接后计算 MD5；`knowledgeId(namespace, ...parts)` 再带命名空间生成确定性主键。
- `knowledgeProjectDigest(projectId)` 等价于 `knowledgeDigest("project", projectId)`，项目范围数据统一保存该摘要，不直接保存项目主键。
- 外部提交号先经 `knowledgeDigest("knowledge-submission", submissionId)` 转换；命令回执、批次、条目、版本和关系均使用确定性 MD5，保证重放和回填幂等。
- 回填旧知识候选时，候选、Loop Run、文档和修订标识只以 MD5 摘要进入证据 JSON，直接标识不得写入新知识模型的证据字段。
- `KnowledgeBatch` 以 `[jobId, submissionId]` 唯一约束接收重复提交；`KnowledgeBatchItem` 以 `[batchId, stableKey, changeType]` 唯一约束避免同一批次重复条目。
- `KnowledgeEntry` 以 `[projectDigest, stableKey]` 唯一定位项目内稳定知识身份；`KnowledgeEntryVersion` 以 `[entryId, version]` 唯一保存追加版本。

## Stage 1 模型

| 模型 | 作用 | 关键约束或索引 |
| --- | --- | --- |
| `KnowledgeSource` / `KnowledgeSourceRevision` | 登记项目知识来源及来源版本、内容摘要和观察证据 | 来源按 `[projectDigest, sourceType, stableKey]` 唯一，修订按 `[sourceId, sourceVersion]` 唯一 |
| `KnowledgePolicy` | 保存项目级自动发布阈值、允许类型、来源/类型覆盖、自动失效/删除/替代开关、调度和空间知识订阅策略 | `projectDigest` 唯一，带版本号；`sourceTypeOverrides` 保存精确覆盖 |
| `KnowledgeTemplate` / `KnowledgeTemplateVersion` | 保存项目知识模板及不可变模板版本 | 模板按 `[projectDigest, stableKey]` 唯一，版本按 `[templateId, version]` 唯一，内容保存 MD5 `contentHash` |
| `KnowledgeJob` | 将项目初始化、任务完成、定时更新或手工更新关联到普通 Task | `projectDigest + status` 查询索引，`dedupeKey` 唯一；`sourceSnapshotDigest` 锁定来源快照身份 |
| `KnowledgeBatch` | 保存一次候选提交的校验、策略、审核、失败和重试进度 | `[jobId, submissionId]` 唯一；失败状态单独保存 `failedStage`、`failureClass`、`failureMessage` |
| `KnowledgeBatchItem` | 保存批次内新建、更新、替代、失效或删除候选、标签、变更说明及审核结论 | `[batchId, stableKey, changeType]` 唯一，保留基线版本与发布版本 |
| `KnowledgeEntry` | 保存稳定知识身份和当前投影状态 | `[projectDigest, stableKey]` 唯一，维护 `latestVersion`、`publishedVersion` 和 `searchable` |
| `KnowledgeEntryVersion` | 保存不可变正文、来源、内容摘要、发布人和发布日期 | `[entryId, version]` 唯一，发布后不覆写历史正文 |
| `KnowledgeRelation` | 保存条目间的依赖、调用、发布、消费、演进、替代等关系 | 按项目、来源条目和目标稳定键建立活动关系索引 |
| `KnowledgeIndexJob` / `KnowledgeIndexVersion` | 保存分块、Embedding、索引激活所需的作业与版本元数据 | 索引作业按状态和项目批次查询；索引版本按项目、模型、分块器和集合唯一 |

`KnowledgeIndexJob` 与 `KnowledgeIndexVersion` 在 Stage 1 只定义持久化契约，不代表向量索引执行器已经实现或运行。

## 发布状态

批次状态词表为：

```text
received -> validating -> policy_evaluating -> review_required -> archiving
         -> chunking -> embedding -> indexing -> activating -> searchable

rejected
 cancelled（Stage 2 状态词表已预留）
failed（通过 failedStage 保留失败阶段）
```

Stage 1 的批次服务实际写入 `policy_evaluating`、`review_required`、`archiving`、`rejected`、`failed` 等状态；`cancelled` 与 `chunking` 之后的索引状态由 Stage 2 承接。部分审核时，已批准条目可以形成不可变版本，但批次保持 `review_required`，直到所有条目都有终态决定。全量审核完成后批次进入 `archiving`，Stage 1 的已发布或已替代回填批次保持 `progress = 45`、`completedAt = null`，直到 Stage 2 完成索引激活。瞬时失败只能从原 `failedStage` 重试，永久失败必须提交新批次。

知识条目状态词表为：

```text
draft | review_required | published | superseded | expired | deleted | rejected
```

`create` 和 `update` 形成 `published` 版本；`supersede`、`expire`、`delete` 形成对应终态并关闭该条目的可搜索标记。Stage 1 发布后将 `searchable` 保持为 `false`，直到 Stage 2 确认新索引已激活。

## 迁移与回填顺序

`deploy/docker-compose.db-init.yml` 对知识域采用以下顺序：

1. `pnpm exec prisma db push --accept-data-loss` 应用当前 Schema。
2. `node prisma/backfill-knowledge-domain.mjs` 执行只读 dry-run，输出计划和待写入数量。
3. `node prisma/backfill-knowledge-domain.mjs --apply` 幂等写入策略、匹配的 KnowledgeJob、批次、条目、版本和关系。
4. `node prisma/backfill-knowledge-domain.mjs` 再次 dry-run，确认待写入数量为零。
5. 执行 `node prisma/seed.mjs` 完成后续初始化。

计划中的每个 Batch 必须引用同一计划内已创建的 Job；拒绝候选只写拒绝批次和条目，不创建 Entry。dry-run 发现计划错误时返回非零并输出脱敏错误码；`--apply` 使用确定性 MD5、`skipDuplicates` 和 `maxWait = 5s`、`timeout = 30s` 的有界事务，先写 Job 再写 Batch，重复执行不会生成重复知识行。

Schema 和回填计划由 `prisma/knowledge-domain-schema.test.mjs` 与 `prisma/knowledge-domain-backfill-plan.test.mjs` 验证。真实数据库的 dry-run、apply、re-dry-run 必须在目标数据库明确授权后执行；Stage 1 本次集成验证没有连接真实数据库执行这三步。

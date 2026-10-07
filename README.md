# HumanThread

HumanThread 是一个面向 AI 辅助交付的 **human-in-the-loop（人在回路）工作平台**。它把公司/个人空间、项目、统一任务、文档、Agent、Loop 与人工审批串成同一条可追踪的交付线程：上下文进入任务，Agent 或 Loop 执行，人工确认后再回到同一个任务上下文。

- 开源仓库：<https://github.com/humanThreads/humanthread>
- 默认分支：`main`

## 项目介绍

### 解决什么问题

AI 能写代码、能跑流程，但"谁决定了什么、执行到哪一步、结果是否被确认"经常散落在聊天记录、终端输出和临时脚本里。HumanThread 的目标是保留一条不断裂的交付线索，让管理者和执行者看到同一个事实来源。

### 核心概念

| 概念 | 说明 |
| --- | --- |
| Space | 公司空间与个人空间，是所有权和访问边界的起点 |
| Project | 承载目标、里程碑、成员、任务、文档与执行配置 |
| Task | 统一的执行单元，负责派发、阻塞、验收和交付跟进 |
| Document | Markdown 兼容的项目与账号上下文，带版本历史 |
| Agent Profile | 绑定 Space 的 Agent 配置，供任务派发与 Loop 节点选用 |
| Loop | 可编排的图执行流程，支持项目级与任务级作用域、人工门禁与子 Loop |
| Knowledge | 项目知识库：候选批次、审核、不可变版本、向量索引与架构视图 |
| Scheduled Task | 定时任务：配置任务内容与绑定的 Loop，按 Worker 或 Local Agent 执行 |

### 设计原则

1. 公司所有权、个人身份和项目成员关系始终显式。
2. 人工执行与自动执行共享同一个 Task 事实，Agent 和 Loop 状态不得伪造交付结论。
3. 下一步动作、阻塞原因和审批状态必须可见。
4. 文档与决策始终挂在产生它们的交付上下文上。
5. Web、Desktop、Agent、MCP 走同一套访问与审计规则。

## 仓库结构

```text
apps/
  web/                      Web 工作台与服务端 API（Next.js）
  local-agent/              Desktop 客户端与本地 Agent（Electron）
  orchestration-worker/     编排 Worker：Loop 调度、索引派发、定时任务
  knowledge-indexer/        知识索引服务（本地中文 Embedding + Qdrant）
  live-relay/               实时会话中继服务
  mobile-android/           Android 客户端（Capacitor 壳）
  desktop-design-preview/   桌面端设计预览
packages/
  db/                       Prisma schema、领域服务与数据访问
  shared/                   Web / 客户端共享类型与契约
  orchestration-core/       Loop 图、调度与门禁核心
  workflow-core/            工作流核心模型
  cli-wrapper/              CLI 回调包装器
  project-loop-sync/        项目 Loop 同步
  workbench-client/         工作台客户端
  knowledge-indexer/        分块、Embedding 与向量库适配
  live-session-journal/     实时会话日志
prisma/                     schema、seed 与回填脚本
deploy/                     Docker Compose 编排
k8s/                        Kubernetes 清单
docs/                       产品与架构文档
```

## 技术栈

- **Web / 服务端**：Next.js、React、TypeScript
- **数据库**：MySQL、Prisma
- **Desktop**：Electron、React、TypeScript
- **移动端**：Android（Capacitor）
- **编排**：Loop 引擎（图执行、人工门禁、子 Loop、失败决策）
- **知识检索**：Qdrant + 本地中文 Embedding
- **部署**：Docker、Docker Compose、Kubernetes
- **工具链**：pnpm workspace、Vitest、TypeScript

## 本地开发

要求 Node.js 24 与 pnpm 10。

```bash
pnpm install
cp .env.example .env
pnpm db:generate
pnpm db:push
pnpm db:seed
pnpm dev
```

Web 默认监听 <http://localhost:3000>，健康检查为 `/api/health` 与 `/api/health/db`，MCP 入口为 `POST /api/mcp`。

常用验证命令：

```bash
pnpm test          # 全工作区测试
pnpm typecheck     # 全工作区类型检查
pnpm build         # 全工作区构建
pnpm lint          # 全工作区 lint
```

面向单个包：

```bash
pnpm --filter @humanthread/web test
pnpm --filter @humanthread/db test
pnpm --filter @humanthread/local-agent test
```

### Desktop 客户端

```bash
pnpm --filter @humanthread/local-agent electron:dev
pnpm --filter @humanthread/local-agent package:macos-dmg
pnpm --filter @humanthread/local-agent electron:build -- --win msi
```

### Android 客户端

```bash
pnpm --filter @humanthread/mobile-android cap:sync
pnpm --filter @humanthread/mobile-android build:apk
```

## 配置与凭据

- 配置模板见 [`.env.example`](.env.example)。
- 只把真实凭据放在 Git 忽略的本地文件或部署平台的 Secret 中。
- 不要提交 Token、Cookie、DSN、数据库连接参数、SSH 私钥或 kubeconfig 内容。
- 新增标识字段使用 32 位小写十六进制 MD5，并以 `CHAR(32)`（或等价类型）存储。

核心变量：

| 变量 | 用途 |
| --- | --- |
| `DATABASE_URL` | MySQL 连接串 |
| `HUMANTHREAD_SITE_BASE_URL` | 站点对外地址，用于生成回调与下载链接 |
| `HUMANTHREAD_SOURCE_REPOSITORY` | AGPL-3.0 第 13 条要求的源码地址 |
| `HUMANTHREAD_BINDING_CODE_SECRET` | Agent 绑定码签名密钥 |
| `HUMANTHREAD_WEB_SESSION_SECRET` / `HUMANTHREAD_DESKTOP_SESSION_SECRET` | Web 与 Desktop 会话签名密钥 |
| `HUMANTHREAD_PROJECT_ENVIRONMENT_SECRET_ENCRYPTION_KEY` | 项目环境变量加密密钥 |
| `HUMANTHREAD_WORKER_POOL_TOKEN_ENCRYPTION_KEY` | Worker 池令牌加密密钥 |

## 文档入口

- [总体设计](docs/product/humanthread-overall-design.md)
- [技术架构](docs/architecture/humanthread-technical-architecture.md)
- [技术选型](docs/architecture/humanthread-stack-decision.md)
- [项目架构](docs/architecture/项目架构/README.md)
- [Loop 市场契约](docs/architecture/loop-market-contract.md)
- [更新记录](CHANGELOG.md)

## 许可证

Copyright (C) 2026 HumanThread contributors

本项目采用 **AGPL-3.0** 许可，完整条款见 [LICENSE](LICENSE)。

以 AGPL-3.0 授权，你可以自由使用、修改和分发本项目。主要义务是：

- 分发本项目或其修改版时，必须提供完整源代码并保留许可证与版权声明。
- **通过网络向用户提供修改版服务时，必须向这些用户提供对应的完整源代码**（AGPL 第 13 条）。
- 修改后的版本必须继续以 AGPL-3.0 授权。

## 贡献

提交贡献前请阅读 [CONTRIBUTING.md](CONTRIBUTING.md)。安全问题请按 [SECURITY.md](SECURITY.md) 报告。

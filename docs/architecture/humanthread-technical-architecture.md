# HumanThread 技术架构计划

> 版本：v0.2
> 状态：公司、空间、文档与 MCP 重构已落地；桌面客户端 2026-09-12 由 Tauri 迁移为 Electron
> 更新时间：2026-09-12
>
> 客户端变更说明：第 3 节历史对比中的 Tauri 选型、第 12 节命令层描述已被
> `docs/architecture/local-agent-electron-migration.md` 取代；Electron 主进程实现同名命令契约，
> `apps/local-agent/electron/` 为唯一原生层。
> 上级文档：`docs/product/humanthread-overall-design.md`
> 产品输入：`docs/product/humanthread-mvp-prd.md`

## 1. 架构目标

技术架构必须服务 HumanThread 的核心闭环：

```text
选择项目/事项
  -> 创建工作流实例
  -> 创建原子任务
  -> 展示一个当前任务
  -> 通过 Web 或本地 Agent 执行
  -> 回传任务状态
  -> 推进工作流
  -> 更新团队可见状态
```

第一版架构必须优先保证：

1. 工作流状态可靠。
2. 任务事件可追踪。
3. 当前任务模型清晰。
4. Web 和本地 Agent 可以通过 API 协作。
5. 本地 Agent 基础能力兼容 macOS、Windows、Linux 三端。
6. 后续可以增加 AI 路由、tmux/ConPTY 会话恢复和 SaaS 能力。

## 2. 推荐技术栈

本项目要求客户端兼容 macOS、Windows、Linux 三端，且技术栈尽量通用。因此推荐优先使用 TypeScript 作为主语言，Web 工作台、本地 Agent UI、共享类型和 CLI 包装器尽量复用同一套生态。

| 层 | 推荐 | 原因 |
| --- | --- | --- |
| Web 前端 | Next.js + React + TypeScript | 适合快速做 Web 工作台和后续 SaaS 化。 |
| 后端 API | Next.js Route Handlers 或 NestJS | MVP 可用 Next.js 一体化，后续复杂后可拆 NestJS。 |
| 数据库 | MySQL 8.x | 用户指定数据库；工作流、事件、队列和审计仍按关系模型设计。 |
| ORM | Prisma | 快速建模、迁移和类型生成。 |
| 实时更新 | 先轮询，后 WebSocket/SSE | MVP 降低复杂度，后续提升体验。 |
| 本地 Agent | Electron + TypeScript/React（主进程承接原生能力；2026-09-12 由 Tauri 迁移） | Electron 支持 Windows、macOS、Linux；UI 复用 React/TypeScript；主进程只承接系统命令、托盘、窗口和权限边界。 |
| CLI 包装器 | Node.js + TypeScript | 与 Web、本地 Agent 共享类型和 API schema；跨平台启动命令、捕获退出码、调用 API。 |
| 会话恢复 | 抽象 Session Adapter；macOS/Linux/WSL 默认 tmux；Windows 后续 ConPTY | 基础客户端三端一致，会话持久化按平台分层实现。 |

MVP 可以先采用单仓库结构，后续再拆分服务。

### 2.1 数据库选型结论

默认选择：MySQL 8.x。

选择理由：

- 用户明确要求使用 MySQL。
- MySQL 8.x 支持事务、行级锁、JSON 字段、索引和常见 SaaS 场景。
- 与 Prisma 兼容，可以继续保留类型生成和迁移能力。
- 对本项目的工作流、任务、事件、队列等关系型数据足够合适。

设计约束：

- 所有状态推进必须在数据库事务中完成，避免任务状态和事件记录不一致。
- `TaskEvent.payload` 等结构化扩展字段使用 MySQL `JSON` 类型。
- 常用查询必须建立组合索引，例如 `teamId + status`、`assigneeUserId + status`、`workflowInstanceId + createdAt`。
- 队列推进要避免并发抢占，必要时使用事务和行级锁。

### 2.2 客户端技术选型结论

默认选择：Electron（2026-09-12 起；原默认选择为 Tauri）。

选择理由：

- 支持 macOS、Windows、Linux 三端桌面应用。
- 可以使用 React/TypeScript 构建 UI，与 Web 工作台复用更多代码。
- 应用体积通常小于 Electron。
- 适合托盘、轻量悬浮窗、本地命令执行、文件路径处理等 Agent 场景。

备选方案：

| 方案 | 使用条件 |
| --- | --- |
| Tauri | 已于 2026-09-12 迁移移除；不再维护 Rust 命令层与双语言栈。 |
| Flutter | 不作为首选。只有当产品转向强原生 UI、多端移动端优先时再评估。 |

三端一致性要求：

- 三端都必须支持登录/绑定、当前任务展示、打开目录、启动命令、回传事件。
- 三端都必须使用同一套 API 协议和共享 TypeScript 类型。
- 平台差异必须封装在 `local-agent` 的系统适配层，不应泄漏到 Core 或 Web 工作台。
- 会话恢复可以分层实现，不要求第一版三端能力完全一致。

### 2.3 身份、公司与空间边界

HumanThread 的登录身份和组织资源必须分离：

```text
User -> CompanyMembership -> Company -> Company Space
  |
  +-> Personal Space

Space -> Project
```

- `User` 是唯一的人类登录主体。公司不能登录，也不能持有个人密码、会话或 MCP 凭据。
- `Company` 是组织实体。用户与公司通过 `CompanyMember` 多对多关联。
- 一个用户只有一个 active personal space，一个公司只有一个 active company space。
- `Project.spaceId` 是新的资源归属边界。Phase 1 保留 `teamId`、`ownerType`、`companyId` 和 `ownerUserId` 作为迁移兼容字段。
- 新组织、空间和权限逻辑禁止通过 `User.teamId` 推断公司归属。
- 注册用户时，在同一事务中创建 `User + Personal Space + Personal Project + ProjectMember(owner)`。
- 创建公司时，在同一事务中创建 `Company + Company Space + CompanyMember(owner)`。

公司空间权限矩阵：

| 角色 | 公司资料与成员 | 公司根资源 | 公司项目 |
| --- | --- | --- | --- |
| `owner` | 管理 | 读写 | 隐式 maintainer |
| `admin` | 管理，受 owner 保护规则限制 | 读写 | 隐式 maintainer |
| `member` | 读取 | 读写 | 必须拥有 active `ProjectMember` |
| `viewer` | 读取 | 只读 | 可见或显式分配项目只读，项目角色不能提权 |

授权规则由 `packages/db` 的空间和项目访问服务统一提供。Web、Agent、HTTP API 和后续 MCP 只负责解析当前 `User` actor，不能各自复制成员查询条件。

空间迁移采用增量流程：

1. `prisma db push` 新增 nullable `Project.spaceId`、`Space`、文档目录、回收站和附件元数据。
2. `prisma/backfill-spaces.mjs` 为已有用户、公司和项目生成/关联空间。
3. 回填脚本验证 legacy owner 与已有 `spaceId` 一致；发现冲突时退出失败，禁止继续 seed。
4. `prisma/backfill-documents.mjs` 为现有文档补齐 `spaceId` 与 `containerKey`。
5. `prisma/seed.mjs` 创建或更新默认空间、示例项目和映射到旧物理表的文档。
6. 现有任务、工作流和 Agent 暂时继续使用 `teamId`，后续按域迁移后再删除兼容字段。

### 2.4 统一文档与 MCP 边界

文档域使用一个逻辑模型：

```text
Document -> Space
         -> Project? (must belong to the same Space)
         -> DocumentRevision[]
```

- Prisma 模型名为 `Document`，通过 `@@map("ProjectDocument")` 复用现有物理表、历史 ID 和 revision 关系。
- 个人/公司根文档使用 `projectId=null`、`containerKey=space:<spaceId>`。
- 项目文档使用 `containerKey=project:<projectId>`，项目必须与文档属于同一个空间。
- Web、普通 API 和 MCP 调用同一套 Workbench 文档服务与 `packages/db` 授权/存储服务。
- 更新和追加要求 `expectedVersion`，事务内执行条件更新并生成 revision。
- Web 文档 API 的 actor 只来自签名 session cookie，请求 body/query 中的 `userId` 不参与授权。

MCP 使用 `@modelcontextprotocol/sdk` `1.29.0` 的 Streamable HTTP：

- `/api/mcp` 支持标准 `initialize`、`notifications/initialized`、`tools/list`、`tools/call` 和 JSON-RPC 错误。
- 当前采用 request-scoped、stateless JSON response 模式，不依赖单实例内存 session。
- 工具包括 `list_spaces`、`list_documents`、`search_documents`、`get_document`、`create_document`、`update_document`、`append_document`。
- bearer credential 只解析 `User` actor；tool handler 不直接访问 Prisma。

## 3. 仓库结构建议

推荐 monorepo：

```text
humanThread/
  apps/
    web/                  # Web 工作台和后端 API
    local-agent/          # Electron 三端本地 Agent
    mobile-android/       # Capacitor Android 客户端壳
  packages/
    shared/               # 共享类型、状态枚举、API schema
    cli-wrapper/          # ht-run TypeScript 包装器
    workflow-core/        # 工作流推进逻辑
    local-system/          # 三端系统能力适配层
  docs/
    product/
    roadmap/
    architecture/
  prisma/
    schema.prisma
```

MVP 如果想更快，也可以先只创建：

```text
humanThread/
  apps/web/
  packages/cli-wrapper/
  docs/
  prisma/
```

本地 Agent 可在 Web MVP 跑通后加入，但数据模型和 API 必须提前预留。

## 4. 核心模块

### 4.1 Workflow Core

职责：

- 根据项目和事项类型创建工作流实例。
- 根据工作流模板创建任务。
- 在任务状态变化后计算下一步。
- 创建任务事件。
- 保证同一用户只有一个主当前任务。

建议作为独立 package，避免业务逻辑散落在 API route 中。

核心函数：

| 函数 | 作用 |
| --- | --- |
| `createWorkflowInstance` | 创建工作流实例和初始任务。 |
| `startTask` | 将任务置为 active。 |
| `completeTask` | 完成任务并推进工作流。 |
| `interruptTask` | 标记任务中断并保留上下文。 |
| `createFollowUpTask` | 创建跟进任务。 |
| `transferTask` | 转交任务。 |
| `routeNextStep` | 根据模板和上下文计算下一步。 |

### 4.2 Web API

MVP API 分组：

| 分组 | API |
| --- | --- |
| 项目 | 创建、列表、详情、更新。 |
| 事项 | 列表、创建事项并启动工作流。 |
| 工作流 | 详情、时间线、任务列表。 |
| 任务 | 当前任务、队列、开始、完成、阻塞、中断、跟进、转交。 |
| 团队 | 成员状态、队列长度、当前任务。 |
| 本地 Agent | 设备绑定、当前任务拉取、事件回传。 |
| CLI 回调 | 任务状态回调、输出摘要上传。 |

MVP 可先使用 REST API。后续需要实时体验时再增加 SSE 或 WebSocket。

当前已落地接口：

| API | 状态 | 说明 |
| --- | --- | --- |
| `GET /api/health/db` | 已完成 | 用于验证 Web 到 MySQL 的连通性。 |
| `POST /api/workflows` | 已完成 | 根据事项类型模板创建工作流实例、初始任务和初始事件。 |
| `GET /api/tasks/current` | 已完成 | 返回某用户当前任务和排队任务数量。 |
| `GET /api/team` | 已完成 | 返回团队成员、当前任务和队列长度基础视图。 |
| `POST /api/tasks/[taskId]/start` | 已完成 | 将任务置为 `active` 并写入 `task_started` 事件。 |
| `POST /api/tasks/[taskId]/complete` | 已完成 | 将任务置为 `completed`、推进工作流，并生成下一任务与对应事件。 |
| `POST /api/tasks/[taskId]/block` | 已完成 | 将任务置为 `blocked`，并记录阻塞原因。 |
| `POST /api/tasks/[taskId]/interrupt` | 已完成 | 将任务置为 `interrupted`，并记录中断原因。 |
| `POST /api/tasks/[taskId]/follow-up` | 已完成 | 将任务置为 `follow_up`，并记录跟进原因。 |
| `POST /api/tasks/[taskId]/transfer` | 已完成 | 将任务置为 `transferred`，并改派给目标用户。 |
| `GET /api/workflows/[workflowId]/timeline` | 已完成 | 返回工作流详情与按时间排序的事件时间线。 |
| `POST /api/agent/device/register` | 已完成 | 本地设备登记、设备 token 复用与授权状态返回。 |
| `POST /api/workbench/login` | 已完成 | Web 工作台账号密码登录接口，校验密码哈希后写入 `ht_workbench_session` 签名 cookie，用于自动化验收和后续客户端登录收敛。 |
| `POST /api/agent/binding-code` | 已完成 | Web 工作台为当前用户签发 10 分钟有效的登录式设备绑定码；当前优先读取签名会话 cookie，body `userId` 仅保留兼容。 |
| `POST /api/agent/login` | 已完成 | 本地 Agent 通过邮箱、密码和设备信息完成登记并自动授权；绑定码仍作为兼容路径自动授权并返回 device token。 |
| `GET /api/agent/current-task` | 已完成 | 返回本地 Agent 可直接消费的当前任务视图，包含本地路径和默认命令。 |
| `POST /api/agent/events` | 已完成 | 接收 `local_opened`、`command_started`、`command_exited` 三类本地事件，并写入时间线与设备记录。 |
| `POST /api/agent/token` | 已完成 | 为指定用户轮换本地 Agent token，并返回一次性明文 token。 |
| `POST /api/cli/tasks/[taskId]/report` | 已完成 | 接收 CLI 执行回调并推进任务状态。 |

当前未完全落地但已保留的接口方向：

- 真实登录态下的本地 Agent 登录、公司上下文选择和自动设备接入。

### 4.3 Web 工作台

页面结构：

```text
/projects                 # 项目列表
/projects/:id             # 项目详情
/matters/new              # 发起事项
/workbench                # 我的当前任务
/team                     # 团队状态面板
/workflows/:id            # 工作流详情
```

设计原则：

- `/workbench` 是用户的默认入口。
- 当前任务必须比任务列表更突出。
- 任务动作必须少而明确。
- 团队页是状态监控，不是复杂项目看板。

当前落地说明：

- 当前实现将 MVP 工作台收敛在首页单页中，先覆盖当前任务、事项创建、团队负载、设备授权和时间线浏览。
- 当前管理 Web 已具备本地 Agent 支撑入口，包括设备授权/撤销和一次性 token 轮换。
- 当前已增加账号密码登录：Web 使用独立 `/login` 外部入口，未登录访问工作台页面会先跳转登录页；`POST /api/workbench/login` 会校验 `User.passwordHash`，成功后写入 `ht_workbench_session` 签名 cookie，工作台上下文优先按签名会话解析用户；旧 `ht_workbench_login_email` 和 `ht_workbench_user_id` cookie 仅作为兼容路径。
- 当前开放注册提供“个人使用 / 创建公司”两种入口；两者创建同一种 `User` 登录身份和个人空间，公司模式额外在同一事务创建 `Company + CompanyMember(owner) + Company Space`。
- 公司成员管理支持已注册用户直接加入、未注册邮箱 pending invitation、注册时自动接受邀请，以及显式 `Serializable` owner 转移；普通角色编辑不能直接授予 owner。
- 文档中心同时展示当前筛选范围内的空间根文档和项目文档；根文档使用 `/documents/:id`，现有项目文档 URL 保持不变。
- 当前已增加公司/个人空间记忆：空间筛选写入 `ht_workbench_space` cookie，并在“我的工作台 / 团队协作 / 项目空间”复用；URL `space` 参数优先级高于 cookie，适合临时切换和可分享链接。
- 当前已增加公司/个人空间切换权限边界：服务端 action 在写入 `ht_workbench_space` 前会解析当前会话，并通过 `getWorkbenchCompanyFilters({ userId })` 校验目标空间是否属于当前用户可访问范围。
- 当前还不是完整后台系统，项目配置、复杂权限、流程设计器等仍在后续阶段。

### 4.4 Local Agent

客户端要求：

- 必须支持 macOS、Windows、Linux 三端构建和运行。
- 默认使用 Electron + React + TypeScript（2026-09-12 起；原 Tauri 方案见迁移记录）。
- 系统相关能力通过 Rust command 或系统适配层封装。
- UI、API client、类型定义尽量与 Web 工作台共享。

MVP 通信模式：

- 本地 Agent 使用用户 token 与服务端通信。
- 先用轮询拉取当前任务，后续再改为 WebSocket/SSE。
- 本地操作通过 API 回传事件。

本地 Agent MVP 能力：

| 能力 | 说明 |
| --- | --- |
| 绑定用户 | 当前支持保存 API 地址、用户邮箱、登录密码、设备信息、绑定码、设备 token、API Token 和命令模板；账号密码登录成功会自动完成设备授权，绑定码保留为兼容路径。 |
| 拉取当前任务 | 已支持轮询并展示当前任务标题、项目、工作流、本地目录和默认命令。 |
| 打开目录 | 已通过 Electron 主进程命令 `open_project_path` 打开项目路径。 |
| 打开终端 | 已通过 Electron 主进程命令 `open_terminal_at_path` 在项目目录打开终端。 |
| 启动命令 | 已通过 Electron 主进程命令 `launch_project_command` 提供默认命令与自定义命令启动入口，并支持命令模板包装。 |
| 回传事件 | 已支持 `local_opened`、`command_started`、`command_exited` 三类事件上报；其中 `command_exited` 通过本地 Agent 托管命令进程并在退出时回传。 |

当前实现备注：

- `apps/local-agent` 已落地前端骨架、绑定存储、API client、浏览器回退运行时和 Electron 主进程命令层。
- 本地 Agent 与 Web 服务端已共用 `@humanthread/shared` 中的 Agent 契约类型。
- 本地 Agent 当前已在轮询和事件上报请求中附带 `Authorization` 头，服务端会基于用户保存的 Agent token 哈希执行强校验。
- 本地 Agent 已支持账号密码和绑定码输入，调用 `POST /api/agent/login` 成功授权后会保存 device token，并清空本地绑定码，避免过期码反复提交。
- 本地 Agent 绑定界面已改为登录绑定优先：常规区只保留登录邮箱、登录密码、绑定码、API Base URL 和设备名称；Team ID、User ID、Device ID、API Token、轮询间隔和命令模板折叠到高级兼容项。
- 当前 seed 默认开发 token 为 `token_123`，仅用于本地开发；服务端和 Web 工作台已提供一次性 token 轮换能力，本地 Agent 侧仍可继续补一键回填与更强提示。
- “打开终端”与“启动命令”分离：前者继续调用系统外部终端，后者走 Agent 受控执行路径，以便可靠回传退出码。
- 当前桌面端仍使用常规窗口，不含托盘与悬浮窗。
- 2026-09-12 已在 macOS 本机完成 Electron `electron:smoke`、`electron-builder --mac zip` 与打包后 App 冒烟验证（见迁移记录）；Windows 需在 Windows 构建机补做 MSI 实机验证。
- 三端实机验证清单见 `docs/architecture/local-agent-cross-platform-verification.md`。

绑定演进方向：

- 当前本地 Agent 已从纯手工绑定和绑定码过渡方案演进到账号密码登录绑定：客户端提交邮箱、密码和设备信息后，服务端自动创建或复用 `LocalDevice` 并授权。
- Web 工作台当前用户优先来自签名会话 cookie，因此绑定码签发已从前端显式传 userId 过渡到服务端登录上下文优先，降低用户误填和跨用户签发风险。
- 手工绑定（Team ID、User ID、Device ID、API Token）仅作为兼容和排障路径，不应成为长期交互负担；API 地址和设备名称保留为常规可配置项。
- 当多用户、多公司登录和权限模型完成后，设备绑定应继续迁移到真实登录驱动流程：先完成用户登录，再由服务端依据登录态、公司上下文和设备指纹创建或复用 `LocalDevice`。
- 设备 token 仍可保留为客户端和服务端的短期校验凭据，但不再要求用户手工复制粘贴。
- Web 工作台保留设备授权/撤销能力，但默认展示“用户 + 设备名 + 平台 + 最近接入时间”，而不是直接暴露低层 ID。
- 如果登录态失效或设备授权被撤销，客户端需要引导用户重新登录或重新申请接入。

三端基础能力矩阵：

| 能力 | macOS | Windows | Linux |
| --- | --- | --- | --- |
| 登录/绑定用户 | 必须支持 | 必须支持 | 必须支持 |
| 展示当前任务 | 必须支持 | 必须支持 | 必须支持 |
| 打开目录 | 必须支持 | 必须支持 | 必须支持 |
| 启动命令 | 必须支持 | 必须支持 | 必须支持 |
| 回传事件 | 必须支持 | 必须支持 | 必须支持 |
| 托盘入口 | 必须支持 | 必须支持 | 必须支持 |
| 悬浮窗 | MVP 可简化 | MVP 可简化 | MVP 可简化 |
| 会话持久化 | tmux | 后续 ConPTY 或降级 | tmux |

### 4.4.1 绑定流程分层

| 阶段 | 绑定方式 | 说明 |
| --- | --- | --- |
| MVP 兼容 | 手工填写 API 地址、Team ID、User ID、Device ID、API Token | 仅保留为联调、排障和早期兼容路径。 |
| 当前主路径 | 客户端填写邮箱、密码、设备名并登录 | 账号密码校验成功后自动授权设备并返回 device token。 |
| 兼容过渡 | Web 生成短期绑定码，客户端填写邮箱、设备名和绑定码 | 用于旧版客户端兼容和排障；有效绑定码自动授权设备并返回 device token。 |
| 稳定版 | 登录态 + 设备指纹 + 授权管理 | 用户不再感知底层 ID，设备接入由 Web 和服务端统一管理。 |

跨平台打开目录策略：

| 系统 | 命令 |
| --- | --- |
| macOS | `open <path>` |
| Windows | `explorer <path>` |
| Linux | `xdg-open <path>` |

跨平台启动命令策略：

| 系统 | 策略 |
| --- | --- |
| macOS | 当前通过 `osascript` 打开 Terminal 并执行 `cd <cwd> && <command>`。 |
| Windows | 当前通过 `cmd /C start ... cmd /K` 拉起新终端执行命令；MVP 不依赖 WSL。 |
| Linux | 当前优先尝试 `x-terminal-emulator`，回退到 `gnome-terminal`、`konsole`、`xterm`。 |
 
所有平台的差异必须收敛在 `local-system` 包或 Electron 主进程命令层。

### 4.5 CLI Wrapper

`ht-run` 是终端和 HumanThread 的桥。

示例：

```bash
ht-run --task <taskId> -- codex
ht-run --task <taskId> -- claude
ht-run --task <taskId> -- npm test
```

职责：

- 从参数或环境变量读取 `taskId`。
- 启动真实命令。
- 捕获退出码。
- 捕获运行时长。
- 捕获最后若干行 stdout/stderr。
- 调用 HumanThread 回调 API。
- 支持手动标记跟进。
- 支持无输出超时检测。

状态映射：

| 终端现象 | 默认任务状态 |
| --- | --- |
| 退出码 0 | completed |
| 非 0 退出码 | interrupted |
| Ctrl+C | interrupted |
| 用户手动 follow-up | follow_up |
| 长时间无输出 | MVP 当前自动上报 follow_up，后续升级为交互式确认 |

### 4.6 Session Adapter

MVP 后半段引入。

接口：

| 方法 | 说明 |
| --- | --- |
| `createSession(taskId, command, cwd)` | 为任务创建会话。 |
| `attachSession(sessionId)` | 恢复会话。 |
| `captureOutput(sessionId, lines)` | 捕获最后输出。 |
| `killSession(sessionId)` | 终止会话。 |
| `getSessionStatus(sessionId)` | 查询会话是否存在。 |

初始实现：

- macOS/Linux/WSL 使用 tmux。
- Windows 原生先降级，不保证进程级恢复；后续通过 ConPTY 或 Windows Terminal profile/session 方案增强。

### 4.7 项目定时任务

项目定时任务是项目范围内的聚合，绑定已启用的项目 Loop 或任务 Loop，并按配置的时区与五段式 Cron 触发。触发时创建现有 `LoopRun` 记录，不引入第二套执行引擎；`ProjectScheduledTaskRun` 是运行台账，记录触发来源、计划槽位、不可变任务/内容/执行目标快照及状态，`LoopRun` 始终是执行权威。

内容边界按运行快照固定：`platform` 模式的平台内容会复制到不可变 Run 快照，并仅在对应 assignment claim 时进入执行输入；`loop_managed` 内容由项目 Loop 自行维护，不进入平台 Run 快照或最终 Stage prompt。平台内容在进入本地 Agent 前执行长度限制和凭据形态脱敏。

运行台账使用确定性 LoopRun 身份和幂等完成事务；`preparing` 行由调度迭代进行有界恢复，先按确定性身份查找已提交的 LoopRun，再补齐台账关联或安全终止，不会在 LoopRun 仍活动时终态关闭台账。子 Loop claim 通过父级 lineage 和 `scheduledTaskRunId` 解析同一项目内的平台内容，保留根 LoopRun 的唯一数据库关联。执行目标按所选 Loop binding 返回兼容选项，并在触发时校验 Local Agent 在线状态或 Worker Pool 容量。

Worker 的滚动开关为 `HUMANTHREAD_ORCHESTRATION_SCHEDULED_TASKS`，默认 `false`。新建的定时任务聚合、运行台账和事件标识统一使用 32 字符小写十六进制 MD5 摘要。调度迭代输出不含正文或凭据的结构化 scan/create/defer/block/fail/recovery 指标，并通过类型化健康分类区分功能关闭、健康扫描、数据库错误和目标解析失败；当前没有独立健康检查端点。

## 5. 数据模型草案

### 5.1 User

字段：

- `id`
- `name`
- `email`
- `status`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

### 5.2 Team

字段：

- `id`
- `name`
- `createdAt`
- `updatedAt`

### 5.3 Project

字段：

- `id`
- `teamId`
- `name`
- `description`
- `localPath`
- `defaultCommand`
- `createdAt`
- `updatedAt`

### 5.4 MatterType

字段：

- `id`
- `teamId`
- `name`
- `description`
- `workflowTemplateId`
- `createdAt`
- `updatedAt`

### 5.5 WorkflowTemplate

字段：

- `id`
- `teamId`
- `name`
- `version`
- `isActive`
- `createdAt`
- `updatedAt`

### 5.6 WorkflowStepTemplate

字段：

- `id`
- `workflowTemplateId`
- `key`
- `title`
- `description`
- `executorType`
- `assigneeUserId`
- `nextStepKey`
- `createdAt`
- `updatedAt`

MVP 先支持线性 `nextStepKey`，后续扩展条件分支。

### 5.7 WorkflowInstance

字段：

- `id`
- `teamId`
- `projectId`
- `matterTypeId`
- `workflowTemplateId`
- `title`
- `description`
- `status`
- `currentStepKey`
- `createdById`
- `createdAt`
- `updatedAt`

### 5.8 Task

字段：

- `id`
- `teamId`
- `workflowInstanceId`
- `projectId`
- `stepTemplateId`
- `title`
- `description`
- `status`
- `executorType`
- `assigneeUserId`
- `queuePosition`
- `localPath`
- `command`
- `startedAt`
- `completedAt`
- `createdAt`
- `updatedAt`

### 5.9 TaskEvent

字段：

- `id`
- `taskId`
- `workflowInstanceId`
- `type`
- `fromStatus`
- `toStatus`
- `actorType`
- `actorUserId`
- `message`
- `payload`
- `createdAt`

`payload` 用于存储输出摘要、退出码、本地事件、AI 摘要等结构化信息。

MySQL 落地要求：

- `payload` 使用 `JSON` 类型。
- 高频筛选字段不要只放在 `payload` 内，应提升为显式列。
- 事件表按 `workflowInstanceId`、`taskId`、`createdAt` 建索引。
- 后续数据量变大后，可以按团队或时间做归档策略。

### 5.10 LocalDevice

字段：

- `id`
- `userId`
- `name`
- `platform`
- `lastSeenAt`
- `createdAt`
- `updatedAt`

### 5.11 ToolSession

字段：

- `id`
- `taskId`
- `localDeviceId`
- `sessionType`
- `sessionName`
- `status`
- `lastOutputSummary`
- `createdAt`
- `updatedAt`

## 6. API 草案

### 6.1 工作流

```http
POST /api/workflows
```

请求：

```json
{
  "projectId": "project_id",
  "matterTypeId": "matter_type_id",
  "title": "实现登录页",
  "description": "需要完成登录页和基础校验"
}
```

结果：

```json
{
  "workflowInstanceId": "workflow_id",
  "firstTaskId": "task_id"
}
```

### 6.2 当前任务

```http
GET /api/tasks/current
```

结果：

```json
{
  "task": {
    "id": "task_id",
    "title": "确认需求",
    "projectId": "project_id",
    "workflowInstanceId": "workflow_id",
    "status": "active",
    "localPath": "/path/to/project",
    "command": "codex"
  },
  "queueLength": 3
}
```

### 6.3 任务动作

```http
POST /api/tasks/:taskId/actions/start
POST /api/tasks/:taskId/actions/complete
POST /api/tasks/:taskId/actions/block
POST /api/tasks/:taskId/actions/interrupt
POST /api/tasks/:taskId/actions/follow-up
POST /api/tasks/:taskId/actions/transfer
```

所有动作都必须写入 `TaskEvent`。

### 6.4 本地 Agent 当前任务

```http
GET /api/agent/current-task
```

用途：

- 本地 Agent 拉取当前任务。
- 返回本地路径、默认命令和任务上下文。

### 6.5 本地 Agent 事件

```http
POST /api/agent/events
```

请求：

```json
{
  "taskId": "task_id",
  "eventType": "command_started",
  "payload": {
    "command": "codex",
    "cwd": "/path/to/project"
  }
}
```

### 6.6 CLI 回调

```http
POST /api/cli/tasks/:taskId/report
```

请求：

```json
{
  "status": "completed",
  "exitCode": 0,
  "durationSeconds": 120,
  "outputSummary": "最后输出摘要",
  "payload": {
    "command": "codex"
  }
}
```

允许状态：

- `completed`
- `interrupted`
- `follow_up`
- `blocked`

## 7. 状态推进规则

MVP 先支持线性流程。

规则：

1. 任务完成后，查找当前步骤的 `nextStepKey`。
2. 如果没有下一步，工作流完成。
3. 如果下一步是人类步骤，创建或激活下一个人类任务。
4. 如果下一步是 AI 步骤，调用 AI executor 或模拟执行。
5. AI 步骤完成后继续执行路由。
6. 中断、阻塞、跟进不会自动推进到正常下一步，除非用户确认。

同一用户当前任务规则：

1. 如果用户没有 active 任务，新任务可以成为当前任务。
2. 如果用户已有 active 任务，新任务进入队列。
3. 当前任务完成后，队列中的下一个任务可以变为当前任务。

## 8. 事件模型

所有关键行为都写入 `TaskEvent`：

- workflow_created
- task_created
- task_started
- task_completed
- task_blocked
- task_interrupted
- task_follow_up_created
- task_transferred
- local_opened
- command_started
- command_exited
- cli_reported
- ai_step_completed

事件记录要求：

- 不覆盖历史。
- 可用于重建时间线。
- 可用于后续分析瓶颈。
- 可用于 AI 学习流程优化。

## 9. 安全与权限 MVP

MVP 最小要求：

- 用户必须登录后访问 Web。
- 本地 Agent 使用 token 绑定用户。
- CLI 回调必须携带 token 或短期 task token。
- 用户只能操作自己团队内的项目和任务。
- 本地目录路径只存用户配置，不应暴露给无权限成员。

后续增强：

- 组织、多团队、多角色权限。
- 多公司、多用户权限成熟后，本地 Agent 的设备绑定改为登录驱动，不再要求手工填写 Team ID、User ID、API Token 和 Device ID。
- 设备授权与撤销入口保留在 Web，但默认只面向当前登录用户的设备列表和接入请求。
- 客户端在登录成功后自动完成设备注册、设备 token 保存和当前用户上下文同步。
- 操作审计。
- 企业 SSO。

## 10. 实时更新策略

MVP：

- Web 工作台和团队面板使用 3-5 秒轮询。
- 本地 Agent 使用 3-5 秒轮询当前任务。

后续：

- WebSocket 或 SSE 推送任务变化。
- 本地 Agent 建立长连接。
- CLI wrapper 可通过本地 Agent 转发事件。

## 11. 开发顺序建议

严格按以下顺序推进：

1. 搭建 Web + MySQL + Prisma 基础。
2. 实现核心数据模型。
3. 实现 Workflow Core 的创建和推进逻辑。
4. 实现当前任务工作台。
5. 实现团队状态面板。
6. 实现任务事件时间线。
7. 实现 Local Agent 最小版本。
8. 实现 CLI wrapper 和回调 API。
9. 实现第一个 AI 辅助开发演示工作流。
10. 再考虑 tmux 会话恢复和 AI 路由增强。

## 12. 关键风险

| 风险 | 应对 |
| --- | --- |
| 做成普通项目管理工具 | 所有功能必须通过总体设计的 6 条方向判断。 |
| 过早做复杂流程设计器 | MVP 先用静态模板，验证闭环后再配置化。 |
| 本地 Agent 复杂度失控 | 第一版只做打开目录、启动命令、回传事件。 |
| CLI 状态误判 | MVP 对超时和不确定状态要求用户确认。 |
| Windows 会话恢复复杂 | 第一版降级，不做进程级恢复。 |
| AI 路由不可控 | 先规则路由，AI 只在受约束步骤内工作。 |

## 13. 技术验收标准

MVP 技术完成标准：

1. MySQL 可以保存项目、事项、流程、任务、事件。
2. API 可以创建工作流并生成第一个任务。
3. 当前任务 API 可以返回用户当前任务和队列长度。
4. 任务完成 API 可以推进工作流。
5. 团队 API 可以展示成员当前状态。
6. 本地 Agent 可以拉取当前任务并打开目录。
7. CLI wrapper 可以回传 completed/interrupted/follow_up。
8. 所有任务状态变化都有事件记录。
9. 第一个 AI 辅助开发演示工作流可以端到端跑通。

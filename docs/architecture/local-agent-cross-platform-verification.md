# Local Agent 三端验证清单

> 状态说明（2026-09-12）：桌面客户端已由 Tauri 迁移为 Electron。本文件中的
> `tauri:dev` / `tauri:build` 命令与 Tauri 专属检查步骤为历史记录；Electron 的
> 开发、冒烟与打包命令见 `docs/architecture/local-agent-electron-migration.md`，
> 三端验收目标与事件契约不变。

## 目标

在 `macOS / Windows / Linux` 三端确认 HumanThread 本地 Agent 的最小闭环一致：

- 绑定用户与 token
- 拉取当前任务
- 打开本地目录
- 在目录打开终端
- 受控执行命令
- 回传 `local_opened` / `command_started` / `command_exited`

## 当前执行口径（2026-05-19）

- 当前阶段 2 先以 `macOS` 作为首个实机验收目标。
- `Windows / Linux` 保留同一份检查清单，待拿到目标机器后补做客户端实机验证。
- 三端兼容目标没有取消，只是按执行顺序后移，不改变总体架构。

## 服务端与管理 Web 当前覆盖范围

- 服务端已覆盖工作流主链路：创建工作流、查询当前任务、团队视图、任务开始/完成/阻塞/中断/跟进/转交、工作流时间线。
- 服务端已覆盖本地 Agent 主链路：`/api/agent/device/register`、`/api/agent/current-task`、`/api/agent/events`、`/api/agent/token`。
- 服务端已覆盖 CLI 回调主链路：`/api/cli/tasks/[taskId]/report`。
- 管理 Web 当前已提供统一工作台首页，覆盖：
  - 创建事项并启动工作流
  - 当前任务操作
  - 团队负载查看
  - 本地设备列表
  - 设备授权 / 撤销
  - 本地 Agent Token 一次性轮换
  - 当前工作流最近时间线
- 当前管理 Web 仍是 MVP 工作台，不包含完整项目后台、复杂权限矩阵和流程设计器。

## 统一前提

- 服务端已执行 `pnpm db:push`
- 服务端已执行 `pnpm db:seed`
- 默认开发用户：`user_owner`
- 默认团队：`team_1`
- 默认开发 token：`token_123`
- 如需本机运行 Tauri，建议使用：
  - `export PATH="/opt/homebrew/opt/rustup/bin:$PATH"`
  - `export RUSTUP_DIST_SERVER="https://rsproxy.cn"`
  - `export RUSTUP_UPDATE_ROOT="https://rsproxy.cn/rustup"`
- 如需本机运行 Tauri 开发模式，可直接执行：
  - `pnpm --filter @humanthread/local-agent tauri:dev -- --no-watch`
- `tauri:dev` 现已支持自动探测可用前端端口：
  - 默认优先 `1420`
  - 若 `1420` 已被占用，会自动回退到下一个可用端口，并同步覆盖 Tauri `devUrl`
- 本地 Agent 绑定页已填写：
  - `API Base URL`
  - `Team ID=team_1`
  - `User ID=user_owner`
  - `API Token=token_123`
- 本地 Agent 绑定区现已提供两个“开发验证预设”按钮：
  - `填入本地 dev 预设`：指向 `http://127.0.0.1:3000`
  - `填入 3010 预设`：指向 `http://127.0.0.1:3010`
  - 两者都会保留当前 `Device ID`、`Device Name` 与 `deviceToken`
- 本地 Agent 绑定区现已提供 `桌面自检` 按钮：
  - 先检查 `/api/health/db`
  - 再检查设备注册/授权状态
  - 若设备已授权，再检查当前任务是否可读
  - 自检结果会写入“最近活动”
  - 绑定区会保留“最近一次桌面自检”摘要面板，显示：
    - 自检时间
    - 数据库连通状态
    - 设备状态
    - 当前任务标题或无任务状态
- 当前桌面端支持手动点击“刷新当前任务”，无需等待默认 10 秒轮询
- 顶部与任务面板都会显示设备授权状态：
  - `已授权`
  - `待授权`
  - `已撤销`
- 可用 `pnpm --filter @humanthread/local-agent verify:events` 直接校验 MySQL 中最近的本地事件 payload 完整性
- 可用 `pnpm --filter @humanthread/local-agent smoke:verify` 一键完成：
  - 本地 Agent smoke 事件链上报
  - 按返回的 `taskId` 自动校验最新 `local_opened / command_started / command_exited`
- 可用 `pnpm --filter @humanthread/local-agent verify:e2e` 一键完成：
  - 自动寻找可用端口并拉起干净的 `next start`
  - 等待 `/api/health/db` 就绪
  - 自动执行 `smoke:verify`
  - 结束后自动关闭临时 Web 进程
- 如只想核对某个任务，可额外传入：
  - `HUMANTHREAD_VERIFY_TASK_ID=<taskId>`
  - `HUMANTHREAD_VERIFY_EVENT_TAKE=20`
  - `HUMANTHREAD_VERIFY_EXPECT_TYPES=local_opened,command_started,command_exited`

## 推荐自动化回归

- 本地先执行：
  - `pnpm --filter @humanthread/local-agent typecheck`
  - `pnpm --filter @humanthread/local-agent test`
- 再执行端到端回归：
  - `HUMANTHREAD_DEVICE_ID=device_mac_1 HUMANTHREAD_DEVICE_NAME=agent-macbook HUMANTHREAD_API_TOKEN=token_123 HUMANTHREAD_PLATFORM=macos pnpm --filter @humanthread/local-agent verify:e2e`
- `verify:e2e` 适合在以下场景作为标准入口：
  - 调整本地 Agent 事件回传逻辑后
  - 调整工作台 `/api/agent/current-task` 或 `/api/agent/events` 后
  - 怀疑本地旧 `next dev` 进程污染验证环境时

## 最近一次实测

- 日期：`2026-05-19`
- 环境：`macOS`
- 命令：`pnpm --filter @humanthread/local-agent verify:e2e`
- 结果：
  - Web 服务成功拉起并完成健康检查
  - `smoke:verify` 返回 `deviceStatus=authorized`
  - 任务 `workflow_1779139803999_p9lhhf:run_cli` 的最新三类事件全部校验通过
  - 临时 `next start` 进程已自动退出，无残留监听端口

## 最近一次 Tauri 开发链路实测

- 日期：`2026-05-19`
- 环境：`macOS`
- 前提：`127.0.0.1:1420` 已被其他 Vite 进程占用
- 命令：`pnpm --filter @humanthread/local-agent tauri:dev -- --no-watch`
- 结果：
  - `beforeDevCommand` 自动切换到 `http://127.0.0.1:1421`
  - Tauri Rust 原生进程成功编译并启动
  - 说明当前本机开发链路已不再依赖固定 `1420`

## 最近一次 Tauri 构建链路实测

- 日期：`2026-05-19`
- 环境：`macOS`
- 命令：`pnpm --filter @humanthread/local-agent tauri:build -- --debug`
- 结果：
  - Tauri Rust 原生构建通过
  - 当前 macOS 本机已具备本地 Agent debug 构建能力

## macOS 正式验收快照

- 验收时间：`2026-05-19 16:29:31 CST`
- 验收环境：`macOS`
- 验收结论：
  - 当前 macOS 端已完成“可自动证明”的阶段 2 最小闭环验收
  - `Windows / Linux` 仍待拿到目标机器后补做同标准实机验证

### 本轮自动化证据

- `pnpm --filter @humanthread/local-agent test`
  - 结果：`24` 个测试文件通过，`67` 个测试通过
- `pnpm --filter @humanthread/local-agent typecheck`
  - 结果：通过
- `HUMANTHREAD_DEVICE_ID=device_mac_1 HUMANTHREAD_DEVICE_NAME=agent-macbook HUMANTHREAD_API_TOKEN=token_123 HUMANTHREAD_PLATFORM=macos pnpm --filter @humanthread/local-agent verify:e2e`
  - 结果：通过
  - 关键事实：
    - `smoke.deviceStatus=authorized`
    - `verify.ok=true`
    - 任务 `workflow_1779139803999_p9lhhf:run_cli` 的 `local_opened / command_started / command_exited` 全部校验通过
- `HUMANTHREAD_VERIFY_TASK_ID=workflow_1779139803999_p9lhhf:run_cli HUMANTHREAD_VERIFY_EXPECT_TYPES=local_opened,command_started,command_exited pnpm --filter @humanthread/local-agent verify:events`
  - 结果：通过
  - 关键 payload 字段已确认存在：
    - `local_opened`：`cwd`、`command`、`deviceId`、`deviceName`、`platform`
    - `command_started`：`cwd`、`command`、`shell`、`processId`
    - `command_exited`：`cwd`、`command`、`shell`、`processId`、`status`、`exitCode`
- `pnpm --filter @humanthread/local-agent tauri:build -- --debug`
  - 结果：通过
  - 产物：`apps/local-agent/src-tauri/target/debug/humanthread-local-agent`

### 当前已被自动化证明的 macOS 能力

- Web 服务可被本地 Agent 端到端拉起并完成健康检查
- 设备注册、授权状态识别与设备 token 复用链路可工作
- 本地事件 `local_opened / command_started / command_exited` 可写入 MySQL
- 事件 payload 结构满足当前校验规则
- Tauri 前端构建与 Rust debug 原生构建可通过

### 当前仍建议人工点按确认的 macOS 能力

- 在桌面端点击 `桌面自检` 后，摘要面板与最近活动文案是否符合预期
- 点击 `打开项目目录` 时 Finder 是否实际打开目标路径
- 点击 `在此处打开终端` 时 Terminal 是否实际在目标目录打开
- 将命令改为 `pwd` 后点击 `启动默认命令`，页面启动反馈与退出反馈文案是否符合预期

### 阶段 2 的 macOS 验收口径

- 如果只看“macOS 先闭环”的当前目标，阶段 2 可视为已达到首个实机验收目标
- 如果按“三端全部实机完成”的完整退出标准，阶段 2 仍未全部完成，剩余项仅为 `Windows / Linux` 客户端实机验证

## macOS 验证

### 1. 绑定与任务拉取

- 启动本地 Agent
- 如当前使用 `next dev`，优先点击 `填入本地 dev 预设`
- 如当前使用干净 `next start` 验证，优先点击 `填入 3010 预设`
- 优先点击 `桌面自检`，确认：
  - Web/DB 已连通
  - 设备状态符合预期
  - 如已授权，当前任务链路可读
- 保存绑定配置
- 如果状态为 `待授权`，确认界面提示需先去工作台授权
- 如果状态为 `已撤销`，确认界面提示需重新授权
- 完成工作台授权后，点击“刷新当前任务”
- 确认当前任务卡片能显示项目、工作流、本地目录、默认命令

### 2. 打开目录

- 点击“打开项目目录”
- Finder 应打开目标路径
- 服务端时间线应出现 `local_opened`

### 3. 打开终端

- 点击“在此处打开终端”
- Terminal 应在目标目录打开新窗口或新标签

### 4. 受控执行命令

- 将命令改为 `pwd`
- 点击“启动默认命令”
- 页面应先出现命令启动反馈
- 命令结束后页面应出现退出反馈
- 服务端时间线应依次出现：
  - `command_started`
  - `command_exited`
  - `command_started` payload 应包含 `command`、`cwd`、`shell`、`processId`

## Windows 验证

### 1. 绑定与任务拉取

- 启动 Tauri 客户端
- 保存绑定配置
- 如未授权或已撤销，先核对状态提示文案是否正确
- 在工作台完成授权后点击“刷新当前任务”
- 确认任务卡片正常显示

### 2. 打开目录

- 点击“打开项目目录”
- 资源管理器应打开目标路径

### 3. 打开终端

- 点击“在此处打开终端”
- 应通过 `cmd /C start ... cmd /K` 打开新终端
- 新终端起始目录应为任务目录

### 4. 受控执行命令

- 将命令改为 `cd`
- 点击“启动默认命令”
- 命令应通过 `cmd /C` 受控执行
- 页面和服务端都应收到 `command_started` 与 `command_exited`
- `command_started` payload 应包含 `shell=cmd /C` 与 `processId`

## Linux 验证

### 1. 绑定与任务拉取

- 启动 Tauri 客户端
- 保存绑定配置
- 如未授权或已撤销，先核对状态提示文案是否正确
- 在工作台完成授权后点击“刷新当前任务”
- 确认任务卡片正常显示

### 2. 打开目录

- 点击“打开项目目录”
- 应通过 `xdg-open` 打开目标路径

### 3. 打开终端

- 点击“在此处打开终端”
- 终端启动优先级应为：
  - `x-terminal-emulator`
  - `gnome-terminal`
  - `konsole`
  - `xterm`

### 4. 受控执行命令

- 将命令改为 `pwd`
- 点击“启动默认命令”
- 命令应通过 `sh -lc` 受控执行
- 页面和服务端都应收到 `command_started` 与 `command_exited`
- `command_started` payload 应包含 `shell=sh -lc` 与 `processId`

## 服务端核对点

- `GET /api/agent/current-task` 返回 200
- 缺少或错误 token 时返回 401
- `POST /api/agent/events` 正常写入三类事件
- `command_started` payload 至少包含：
  - `cwd`
  - `command`
  - `processId`
  - `shell`
- `command_exited` payload 至少包含：
  - `cwd`
  - `command`
  - `processId`
  - `shell`
  - `status`
  - `exitCode`

## 已知限制

- 当前机器已可完成 Tauri 本地 debug 构建，但默认 Homebrew `rustc 1.87.0` 不足以支撑项目依赖
- 项目当前应优先通过 `rustup stable` 运行 Tauri/Rust 命令
- Windows 侧暂未接 `ConPTY`
- Linux 侧仍依赖常见桌面终端存在
- 设备注册凭据已落地，手动刷新和 `pending/revoked` 提示已补齐；吊销后的更强提醒和凭据轮换 UX 仍可继续完善
- 现存库中仍有少量历史旧事件不满足当前 payload 规则：
  - 旧的 Web workbench `local_opened` 使用 `localPath`，未统一为 `cwd`
  - 早期 `command_started` 未记录 `shell` 与 `processId`

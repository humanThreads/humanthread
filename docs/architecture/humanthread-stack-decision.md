# HumanThread 技术栈决策记录

> 版本：v0.2
> 状态：已确认（2026-09-12 桌面客户端由 Tauri 迁移为 Electron，见
> docs/architecture/local-agent-electron-migration.md）
> 更新时间：2026-09-12

## 1. 决策结果

HumanThread MVP 使用以下技术栈：

| 层 | 技术 |
| --- | --- |
| Web 工作台 | Next.js + React + TypeScript |
| 后端 API | Next.js Route Handlers，后续复杂后可拆 NestJS |
| 数据库 | MySQL 8.x |
| ORM | Prisma |
| Monorepo | pnpm workspace |
| 共享类型 | TypeScript package |
| 工作流核心 | TypeScript package |
| CLI 包装器 | Node.js + TypeScript |
| 三端客户端 | Electron + React + TypeScript（主进程承接原生能力；Android 使用 Capacitor 壳复用 Web 工作台） |
| 会话恢复 | 抽象 Session Adapter；macOS/Linux/WSL 使用 tmux；Windows 后续 ConPTY 或降级 |

## 2. 关键约束

- 客户端必须兼容 macOS、Windows、Linux。
- 尽量复用 TypeScript、React、API schema 和共享类型。
- 平台差异必须封装在本地 Agent 的系统适配层。
- 数据库使用 MySQL，不使用 PostgreSQL。
- 第一阶段优先跑通核心闭环，不做复杂流程设计器。

## 3. 为什么选择 Electron（2026-09-12 更新）

原方案为 Tauri，现按产品要求迁移为 Electron：

- 桌面端统一 Node + TypeScript 技术栈，不再维护 Rust 工具链与双语言命令层。
- 托盘、通知、深链、文件系统、子进程由 Electron 主进程统一承接，行为对齐原
  Tauri command 契约，渲染层保持 React/TypeScript 不变。
- electron-builder 统一产出 macOS zip/dmg 与 Windows MSI，发布继续复用 OSS 分发协议。
- 安全边界以 `contextIsolation + sandbox + 路径/命令白名单` 实现，验证见迁移文档。

## 4. 为什么保留 Node.js

Node.js 不是桌面客户端框架，但适合：

- Next.js 后端 API。
- `ht-run` CLI 包装器。
- 脚本和开发工具。
- 共享 TypeScript 类型和 API client。

最终分工：

```text
Node.js：Web、API、CLI、工具链、桌面客户端主进程
Electron：桌面客户端窗口与原生能力桥接
Capacitor：Android 客户端壳
MySQL：持久化工作流、任务、事件和队列
```

## 5. 当前环境备注

当前机器已具备：

- Node.js
- npm
- pnpm

当前机器不再需要 Rust/Cargo；桌面客户端构建依赖 Node 与 electron-builder，
Android 构建依赖 JDK 21 与 Android SDK。

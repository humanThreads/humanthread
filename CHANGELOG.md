# 更新记录

## 2026-10-07 — 开源初始化

首次以开源方式发布 HumanThread，代码快照来自内部主干的当前状态，历史记录从本仓库重新开始。

### 版本

| 组件 | 版本 |
| --- | --- |
| 根包 `humanthread` | 0.1.5 |
| `@humanthread/web` | 0.1.5 |
| `@humanthread/local-agent` | 0.1.5 |
| `@humanthread/mobile-android` | 0.1.5 |
| `@humanthread/desktop-design-preview` | 0.0.0（设计预览，不参与发布） |
| `@humanthread/orchestration-worker` | 0.1.2 |
| `@humanthread/knowledge-indexer-service` | 0.1.2 |
| 其余 `packages/*` | 0.1.2 |

### 当前能力

- **交付工作台**：公司 / 个人空间、项目、统一任务、文档、站内信与搜索。
- **Loop 编排**：图执行引擎、项目级与任务级作用域、人工门禁、子 Loop、失败分类与事务化重试、不可变运行快照。
- **Agent 与执行环境**：Space 级 Agent Profile、本地 Agent（Electron）、Linux Worker 池、Docker 与 Kubernetes 部署形态。
- **MCP 接入**：文档、项目、任务、知识与工作流交互工具，按项目访问边界鉴权。
- **项目知识库**：候选批次提交与审核、不可变版本、混合检索、架构视图、自动审核策略配置。
- **项目定时任务**：定时任务清单、历史运行日志与运行报告，支持手动执行、状态筛选、Worker 与 Local Agent 两种执行方式，内容支持平台托管与 Loop 自管。
- **实时会话**：Loop 执行阶段事件与终端输出通过实时中继推送到 Web。

### 交付形态

- Web 与编排 Worker 使用同一镜像，Dockerfile 见仓库根目录。
- 知识索引服务与 Qdrant 由 Docker Compose 在本机编排。
- Desktop 提供 macOS 与 Linux 打包脚本，Android 提供 Capacitor 壳与 APK 构建脚本。

### 已知边界

- macOS DMG 默认未做 Apple 公证，首次打开可能提示"无法验证开发者"。
- Android 正式签名依赖 `HUMANTHREAD_ANDROID_KEYSTORE_*` 注入，未注入时产物为未签名包。
- Windows Desktop 产物未签名。
- 知识索引服务的 Embedding 模型需要在本机下载或预置后再启动。

### 发布产物

| 产物 | 文件 | SHA-256 |
| --- | --- | --- |
| Desktop macOS arm64 | `HumanThread-Desktop-0.1.5-mac-arm64.dmg` | 见 Release 说明 |
| Android universal | `HumanThread-0.1.5-android.apk` | 见 Release 说明 |

产物随附 [NOTICE](NOTICE) 与 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，对应源码见 <https://github.com/humanThreads/humanthread>。

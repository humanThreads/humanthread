# 本地客户端 Tauri → Electron 迁移记录

日期：2026-09-12
状态：桌面端迁移已实现并在本机通过自动化验证；Windows 产物与签名/公证仍待相应构建机验证。

## 1. 决策与原因

按产品要求，macOS 与 Windows 本地客户端由 Tauri v2 迁移为 Electron：

- 桌面端与 Web/Workbench 统一到 Node + TypeScript 技术栈，原生层不再依赖 Rust 工具链。
- 原生能力（托盘、系统通知、深链、文件系统、子进程）由 Electron 主进程统一承接，行为对齐原 Rust command 契约。
- Windows 安装包改为 electron-builder MSI，macOS 输出 zip（保留 dmg 目标）。

渲染层（React 19 + Vite 8 + HashRouter）保持不动，只替换 `@tauri-apps/*` 桥接。

## 2. 代码结构

```
apps/local-agent/
  electron/
    main.ts                 # 应用生命周期、窗口、托盘、深链、单实例、IPC 注册
    preload.ts              # contextBridge 暴露 window.humanthreadNative
    commands.ts             # 45 个原生命令的 IPC 分发与桌面动作校验
    lib/core.ts             # 进程执行、环境变量白名单、平台命令构造
    lib/workspace.ts        # Workspace 路径约束、Git、原子写文件、结构文件替换
    lib/agent-runtime.ts    # Codex/Claude 探测、安装、Codex 参数与绑定校验
    lib/local-model.ts      # 凭据、模型站点/目录/路由、隔离 CODEX_HOME、模型发现
    lib/codex-app-server.ts # Codex app-server JSON-RPC 注册表与事件
    lib/processes.ts        # Codex CLI 进程、受管命令注册表、终端/会话恢复
  build-resources/          # 图标（由原 Tauri 图标迁移）
  electron-builder.yml      # 打包配置（mac zip+dmg / win msi）
  scripts/electron-bundle.ts / electron-dev.ts / electron-smoke.ts / electron-build.ts
  scripts/package-macos-download.ts / package-macos-dmg.ts / publish-macos-download.ts
```

`src-tauri/`、`@tauri-apps/*` 依赖与 Tauri 专用脚本已全部移除。

## 3. IPC 契约

- 命令：`invoke(command, args)` 统一走 `humanthread:command` IPC，主进程返回
  `{ ok: true, result }` 或 `{ ok: false, error }`；preload 解包后按原语义抛出
  `Error`（`provider_*:` 前缀会还原为 `code` 属性），渲染层无需改动调用形态。
- 事件：主进程 `humanthread:event` 推送 `{ event, data }`，preload 适配为 Tauri 的
  `{ payload }` 形态。事件清单：`codex_process_output|exit`、`command_exited`、
  `codex_app_server_notification|state`、`desktop_notification_action`、
  `desktop_window_visibility`、`desktop_tray_action`、`desktop_quit_requested`。
- 存储：`plugin-store` 由主进程 `userData/stores/<name>` JSON 存储替代，
  `loadStore` 接口保持 `get/set/save`。
- 对话框、外链、深链、通知权限由 preload 暴露的桥 `window.humanthreadNative` 提供。

## 4. 安全边界（与原 Rust 层对齐）

- 窗口：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`、
  `backgroundThrottling: false`（窗口隐藏时 Loop Worker 持续运行）。
- Workspace 路径：绝对路径、逐组件解析、`..` 未解析路径拒绝、realpath 包含性校验、
  符号链接拒绝（目录树/迁移/结构文件）。
- 写文件：1 MiB 上限、独占创建、临时文件 + rename 原子替换、
  `CLAUDE.md` 只允许替换 HumanThread 受管块。
- 凭据：仅保存在 `~/.humanthread/accounts/<sha256(origin|user)>/credentials.json`，
  POSIX 下 0600/0700；凭据值不进入事件、日志与状态响应；独立凭据执行使用隔离
  `CODEX_HOME`，并剔除 `CODEX_HOME/OPENAI_*` 继承环境。
- 外部动作：Web handoff 仅允许当前部署 origin 的
  `/api/desktop/web-handoff/consume?code=...`；系统通知与托盘菜单有固定 id/文案/路由校验；
  深链仅允许 `humanthread://open/<allowlist>`。
- Codex 参数：只允许 `exec` 只读/受控沙箱参数白名单，本地模型 provider 必须与所选站点
  base_url 一致且显式指定模型。

## 5. 打包与发布

- macOS：`pnpm --filter @humanthread/local-agent package:macos-download`
  产出 `humanthread-local-agent-macos-arm64.zip`；
  `package:macos-dmg` 产出 `HumanThread-<version>-mac-arm64.dmg`（electron-builder）。
- Windows：`pnpm --filter @humanthread/local-agent electron:build -- --win msi`
  产出 MSI；版本号与根 `package.json` 一致（本次发布 0.1.4），升级标识保持不变。
- 稳定发布由分发方自行选择上传器；打包脚本只负责在 `main` 干净检出且
  `HEAD == origin/main` 时产出制品。

## 6. 验证证据（2026-09-12）

- `pnpm --filter @humanthread/local-agent typecheck`：通过。
- `pnpm --filter @humanthread/local-agent test`：126 个测试文件、597 个用例通过
  （含新增的 Electron 原生层测试：workspace 约束、Codex 参数、凭据/模型、JSON-RPC、
  命令分发）。
- `pnpm --filter @humanthread/local-agent build`：tsc + vite + esbuild 主进程打包通过。
- `pnpm --filter @humanthread/local-agent electron:smoke`：真实启动 Electron，
  渲染层 `did-finish-load` 标记出现，进程以 0 退出。
- `electron-builder --mac zip --arm64`：产出 `HumanThread-0.1.3-mac-arm64.zip`
  （约 128 MB，未签名，未配置 Developer ID 时 electron-builder 明确跳过签名）。
- Windows MSI 需要在 Windows 构建机产出；未配置证书时产物为未签名包。
- `packageMacosDownload` 全流程：electron-builder → 解压 → `xattr -cr` →
  验签（未签名时告警、不伪造成功）→ 写入 README → 重新打包
  `humanthread-local-agent-macos-arm64.zip`。
- 打包后的 App 直接启动冒烟：`[humanthread-smoke] renderer-loaded`，退出码 0。

已知限制：Electron 框架不适用 `codesign --force --deep --sign -` 这类 ad-hoc 重签
（会破坏嵌套框架完整性），脚本改为“验签+如实标记未签名”，签名依赖 Developer ID。

## 7. 未完成 / 阻塞

- Windows MSI 需要在 Windows 构建机上实际产出与安装验证；当前环境无 Windows 机器。
- macOS 代码签名与公证、Windows 代码签名未配置；当前 zip/MSI 为未签名产物。
- Linux 桌面端未纳入本次要求（README 中保留规则但未构建）。
- 应用图标沿用原 Tauri 图标资源（`build-resources/`），品牌视觉未更新。

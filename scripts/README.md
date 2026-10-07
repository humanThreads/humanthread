# 脚本说明

本目录只保留与开源仓库直接相关的开发辅助脚本：

- `fix-node-esm-specifiers.mjs`：修正 Node ESM 相对导入的扩展名。
- `prepare-loop-development-environment.mjs`：为 Loop 开发准备本地环境。
- `releases/release-source.mjs`：校验打包来源分支与远端一致性，供客户端打包脚本复用。

与特定部署环境绑定的发布流水线、镜像同步与运维脚本不在开源仓库中维护。

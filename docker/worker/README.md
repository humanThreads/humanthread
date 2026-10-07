# HumanThread Linux Worker Images

标准 Worker 镜像与 Web 镜像使用同一套源码，构建入口见 `docker/worker/Dockerfile`。
基础镜像与 npm registry 通过 `NODE_BASE_IMAGE`、`NPM_REGISTRY` 参数覆盖，
默认使用 `node:24-bookworm-slim` 与官方 npm registry。

## 运行时配置

运行期凭据通过 Docker `--env-file` 或 Kubernetes Secret 注入，不要烘焙进镜像层：

- `HT_PLATFORM_URL`：平台地址，必填。
- `HT_WORKER_POOL_NAME`：Worker 池显示名，必须与签发令牌的池完全一致。
- `HT_WORKER_POOL_TOKEN`：Worker 池令牌，必填。
- `HT_GIT_USERNAME` + `HT_GIT_TOKEN`：可选，Git 拉取凭据，两者必须同时提供。
- `GIT_AUTHOR_NAME` + `GIT_AUTHOR_EMAIL`：可选，提交作者信息。
- `HT_WORKER_INSTANCE_ID`：可选，副本级实例标识，默认使用容器主机名。

标准镜像通过 entrypoint 启动 `ht worker run`。模型地址、API Key、模型名与
推理强度只来自平台签发的不变 assignment，不通过镜像或环境变量预设。

## 派生镜像

需要额外系统依赖的项目可以基于标准镜像构建派生镜像，参考
[`project.Dockerfile.example`](./project.Dockerfile.example)。仓库同时提供
[`humanthread-dev.Dockerfile`](./humanthread-dev.Dockerfile)，在标准镜像之上
加入 pnpm 与本仓库 monorepo 构建所需的原生工具链。

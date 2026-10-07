import { describe, expect, it } from "vitest";
import { evaluateDockerWorkerLifecycle, evaluateKubernetesWorkerLifecycle, generateWorkerDeploymentCommands, workerDeploymentConfigurationSchema } from "./worker-deployment-commands";
import { defaultWorkerRuntimeEnvironment } from "./worker-runtime-environment";

const base = {
  projectId: "project_1",
  projectShortCode: "HT",
  poolId: "a".repeat(32),
  image: "registry.example.com/ht-worker@sha256:" + "b".repeat(64),
  configVersion: 3,
  concurrency: 2,
  sessionJournalRetentionDays: 30,
  cpu: "2",
  memory: "4Gi",
  gpu: 0,
  ephemeralStorage: "10Gi",
  persistentStorage: "20Gi",
  minReplicas: 1,
  maxReplicas: 3,
  capabilities: { workspace: true, files: true, commands: true },
  healthPort: 8080,
  runtimeEnvironment: defaultWorkerRuntimeEnvironment("node-pnpm"),
};

describe("Worker 部署命令模型", () => {
  it("只接受项目已保存的不可变镜像引用，不接受临时 tag 或 latest", () => {
    expect(workerDeploymentConfigurationSchema.safeParse({ ...base, runtime: "docker", image: undefined }).success).toBe(false);
    expect(workerDeploymentConfigurationSchema.safeParse({ ...base, runtime: "docker", image: "registry.example.com/worker:20260916" }).success).toBe(false);
    expect(workerDeploymentConfigurationSchema.safeParse({ ...base, runtime: "docker", image: "registry.example.com/worker:latest" }).success).toBe(false);
  });

  it("生成命令使用项目配置解析出的 digest，而不是可漂移的 tag", () => {
    const result = generateWorkerDeploymentCommands({ ...base, runtime: "docker", image: "registry.example.com/worker@sha256:" + "c".repeat(64), imageTag: "20260916-a" });
    expect(result.commands[0]!.command).toContain("registry.example.com/worker@sha256:" + "c".repeat(64));
    expect(result.commands[0]!.command).not.toContain(":20260916-a");
  });

  it("部署命令携带 Worker Pool 注册凭证，更新和卸载命令不重复暴露凭证", () => {
    const result = generateWorkerDeploymentCommands({ ...base, runtime: "docker", namespace: "ht", platformUrl: "http://localhost:3000", poolName: "ht-agnet", poolToken: "htwp_test_token" });
    expect(result.commands[0]!.command).toContain("HT_PLATFORM_URL='http://localhost:3000'");
    expect(result.commands[0]!.command).toContain("HT_WORKER_POOL_TOKEN=%s");
    expect(result.commands[0]!.command).toContain("'htwp_test_token'");
    expect(result.commands[0]!.command).toContain("'ht-agnet'");
    expect(result.commands[1]!.command).not.toContain("htwp_test_token");
    expect(result.commands[2]!.command).not.toContain("htwp_test_token");
  });

  it("生成 Docker 部署、更新、卸载三条命令且不包含凭证", () => {
    const result = generateWorkerDeploymentCommands({ ...base, runtime: "docker", namespace: "ht" });
    expect(result.commands.map((command) => command.operation)).toEqual(["deploy", "update", "uninstall"]);
    expect(result.commands[0]!.command).toContain("docker run");
    expect(result.commands[1]!.command).toContain("docker rm");
    expect(result.commands[2]!.command).toContain("docker rm");
    expect(result.commands.map((command) => command.command).join(" ")).toContain("CONFIG_VERSION=3");
    expect(result.commands[0]!.command).toContain("HT_WORKER_RUNTIME=docker");
    expect(result.commands[0]!.command).toContain("HT_MAX_CONCURRENT_RUNS=2");
    expect(result.commands[0]!.command).not.toContain("HT_WORKER_CONCURRENCY");
    expect(result.commands[0]!.command).toContain("HT_WORKER_CAPABILITIES");
    expect(result.commands[0]!.command).toContain("/var/lib/humanthread/pnpm");
    expect(result.commands[0]!.command).toContain("HT_WORKER_INSTANCE_ID=ht-ht-aaaaaaaaaaaa");
    expect(result.commands[0]!.command).toContain("source=ht-ht-aaaaaaaaaaaa-state");
    expect(JSON.stringify(result)).not.toMatch(/token|password|secretValue|Bearer/iu);
  });

  it("生成 Kubernetes namespace、PVC、Deployment 和弹性 HPA 命令", () => {
    const result = generateWorkerDeploymentCommands({ ...base, runtime: "kubernetes", namespace: "ht-prod", storageClass: "fast", poolName: "ht-agnet" });
    const commands = result.commands.map((command) => command.command).join("\n");
    expect(commands).toContain("kubectl apply");
    expect(commands).toContain("kind: Namespace");
    expect(commands).toContain("kind: PersistentVolumeClaim");
    expect(commands).toContain("kind: Deployment");
    expect(commands).toContain("kind: HorizontalPodAutoscaler");
    expect(commands).toContain("kind: ServiceAccount");
    expect(commands).toContain("kind: Role");
    expect(commands).toContain("kind: RoleBinding");
    expect(commands).toContain("kind: ConfigMap");
    expect(commands).toContain("readinessProbe:");
    expect(commands).toContain("HT_WORKER_RUNTIME");
    expect(commands).toContain("HT_WORKER_TASK_GROUP_NAME");
    expect(commands).toContain('HT_WORKER_TASK_GROUP_NAME: "ht-agnet"');
    expect(commands).toContain("mountPath: /var/lib/humanthread");
    expect(commands).toContain("HT_LIVE_SESSION_JOURNAL_RETENTION_DAYS");
    expect(commands).toContain("HT_WORKER_SHARED_STORAGE");
    expect(commands).toContain("HT_WORKER_TASK_ROOT");
    expect(commands).toContain("HT_WORKER_LOCK_MODE");
    expect(commands).toContain("HT_MAX_CONCURRENT_RUNS");
    expect(commands).toContain("HT_WORKER_CAPABILITIES");
    expect(commands).toContain("/var/lib/humanthread/pnpm");
    expect(commands).toContain("containerPort: 8080");
    expect(commands).toContain("humanthread.io/idle-window-seconds: \"60\"");
    expect(commands).toContain("humanthread.io/idle-workers-target: \"1\"");
    expect(commands).toContain("minReplicas: 1");
    expect(commands).toContain("maxReplicas: 3");
    expect(result.commands[2]!.command).toContain("retain");
  });

  it("Kubernetes 更新命令会重启并等待 Worker 就绪，使 ConfigMap 新配置重新注册", () => {
    const result = generateWorkerDeploymentCommands({ ...base, runtime: "kubernetes", namespace: "ht-prod" });
    const update = result.commands.find((command) => command.operation === "update");

    expect(update?.command).toContain("kubectl rollout restart deployment/ht-ht-aaaaaaaaaaaa -n ht-prod");
    expect(update?.command).toContain("kubectl rollout status deployment/ht-ht-aaaaaaaaaaaa -n ht-prod");
  });

  it("使用自定义挂载根目录时统一解析任务目录和缓存目录", () => {
    const runtimeEnvironment = {
      ...defaultWorkerRuntimeEnvironment("node-pnpm"),
      mountPath: "/workspace",
    };
    const result = generateWorkerDeploymentCommands({ ...base, runtime: "kubernetes", namespace: "ht-prod", runtimeEnvironment });
    const commands = result.commands.map((command) => command.command).join("\n");
    expect(commands).toContain("mountPath: /workspace");
    expect(commands).toContain("HT_WORKER_TASK_ROOT: \"/workspace/tasks\"");
    expect(commands).toContain("PNPM_HOME: \"/workspace/pnpm\"");
    expect(commands).toContain("npm_config_cache: \"/workspace/npm\"");
    expect(commands).toContain("XDG_CACHE_HOME: \"/workspace/cache\"");
  });

  it("拒绝非 digest 镜像、非法 namespace 和不合理副本范围", () => {
    expect(workerDeploymentConfigurationSchema.safeParse({ ...base, runtime: "docker", image: "registry.example.com/worker:latest" }).success).toBe(false);
    expect(workerDeploymentConfigurationSchema.safeParse({ ...base, runtime: "kubernetes", namespace: "../prod" }).success).toBe(false);
    expect(workerDeploymentConfigurationSchema.safeParse({ ...base, runtime: "kubernetes", minReplicas: 4, maxReplicas: 2 }).success).toBe(false);
  });

  it("Docker 预检缺项时阻止部署，部署后必须完成全部运行态核验", () => {
    const result = evaluateDockerWorkerLifecycle({
      preflight: { dockerCli: true, imageAuthenticated: false, envReady: true, volumeReady: true, resourcesValid: true },
      runtime: { containerHealthy: true, platformRegistered: true, sessionEstablished: true, heartbeatHealthy: true, capabilitiesMatched: true, noSideEffectClaimPassed: false },
    });
    expect(result.canDeploy).toBe(false);
    expect(result.canFinish).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(["镜像仓库未登录", "无副作用 claim 未通过"]));
  });

  it("Docker 预检和部署后核验全部通过时允许结束", () => {
    expect(evaluateDockerWorkerLifecycle({
      preflight: { dockerCli: true, imageAuthenticated: true, envReady: true, volumeReady: true, resourcesValid: true },
      runtime: { containerHealthy: true, platformRegistered: true, sessionEstablished: true, heartbeatHealthy: true, capabilitiesMatched: true, noSideEffectClaimPassed: true },
    })).toEqual({ canDeploy: true, canFinish: true, blockers: [] });
  });

  it("Kubernetes 生命周期只有清单和运行态核验全部通过时允许结束", () => {
    const result = evaluateKubernetesWorkerLifecycle({
      preflight: { kubeconfig: true, contextAuthorized: true, namespaceReady: true, quotaReady: true, storageClassReady: true, imagePullSecretReady: true, workerSecretReady: true },
      runtime: { namespaceCorrect: true, rolloutComplete: true, podsReady: true, pvcBound: true, platformRegistered: true, heartbeatHealthy: true, noSideEffectClaimPassed: true },
    });
    expect(result).toEqual({ canDeploy: true, canFinish: true, blockers: [] });
  });

  it("Kubernetes 缺少 Secret 或 PVC 时保持阻塞", () => {
    const result = evaluateKubernetesWorkerLifecycle({
      preflight: { kubeconfig: true, contextAuthorized: true, namespaceReady: true, quotaReady: true, storageClassReady: true, imagePullSecretReady: false, workerSecretReady: true },
      runtime: { namespaceCorrect: true, rolloutComplete: false, podsReady: false, pvcBound: false, platformRegistered: false, heartbeatHealthy: false, noSideEffectClaimPassed: false },
    });
    expect(result.canDeploy).toBe(false);
    expect(result.canFinish).toBe(false);
    expect(result.blockers).toEqual(expect.arrayContaining(["镜像拉取 Secret 未就绪", "PVC 尚未绑定"]));
  });
});

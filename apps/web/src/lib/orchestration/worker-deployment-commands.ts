import { z } from "zod";
import { defaultWorkerRuntimeEnvironment, resolveWorkerRuntimeEnvironment, validateWorkerRuntimeVariables, workerRuntimeEnvironmentSchema } from "./worker-runtime-environment";

const digestImage = z.string().trim().regex(/^.+@sha256:[a-f0-9]{64}$/u, "Worker 镜像必须固定为 sha256 digest");
const namespace = z.string().trim().regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/u).max(63);

export const workerDeploymentConfigurationSchema = z.object({
  projectId: z.string().trim().min(1).max(96),
  projectShortCode: z.string().trim().regex(/^[A-Z0-9-]{2,12}$/u),
  poolId: z.string().regex(/^[a-f0-9]{32}$/u),
  runtime: z.enum(["docker", "kubernetes"]),
  namespace: namespace.optional(),
  storageClass: z.string().trim().regex(/^[a-z0-9]([-a-z0-9.]*[a-z0-9])?$/u).max(63).optional(),
  image: digestImage,
  imageTag: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,190}$/u).optional(),
  configVersion: z.number().int().positive(),
  concurrency: z.number().int().positive().max(128),
  sessionJournalRetentionDays: z.number().int().min(1).max(3_650).default(30),
  cpu: z.string().trim().min(1).max(32),
  memory: z.string().trim().min(1).max(32),
  gpu: z.number().int().min(0).max(16),
  ephemeralStorage: z.string().trim().min(1).max(32),
  persistentStorage: z.string().trim().min(1).max(32),
  minReplicas: z.number().int().min(1).max(100),
  maxReplicas: z.number().int().min(1).max(100),
  capabilities: z.record(z.string(), z.boolean()).default({ workspace: true, files: true, commands: true }),
  healthPort: z.number().int().min(1).max(65_535).default(8080),
  runtimeEnvironment: workerRuntimeEnvironmentSchema.default(defaultWorkerRuntimeEnvironment("custom")),
  poolName: z.string().trim().min(1).max(191).optional(),
  poolToken: z.string().trim().min(1).max(4096).optional(),
  platformUrl: z.string().url().max(1024).optional(),
}).strict().refine((value) => value.minReplicas <= value.maxReplicas, { message: "最小副本数不能大于最大副本数", path: ["maxReplicas"] }).superRefine((value, context) => {
  if (value.runtime === "kubernetes" && !value.namespace) context.addIssue({ code: "custom", message: "Kubernetes 必须指定 namespace", path: ["namespace"] });
});

export type WorkerDeploymentConfiguration = z.infer<typeof workerDeploymentConfigurationSchema>;
export type WorkerDeploymentOperation = "deploy" | "update" | "uninstall";

export type KubernetesWorkerLifecycleInput = {
  preflight: { kubeconfig: boolean; contextAuthorized: boolean; namespaceReady: boolean; quotaReady: boolean; storageClassReady: boolean; imagePullSecretReady: boolean; workerSecretReady: boolean };
  runtime: { namespaceCorrect: boolean; rolloutComplete: boolean; podsReady: boolean; pvcBound: boolean; platformRegistered: boolean; heartbeatHealthy: boolean; noSideEffectClaimPassed: boolean };
};

export function evaluateKubernetesWorkerLifecycle(input: KubernetesWorkerLifecycleInput) {
  const blockers: string[] = [];
  if (!input.preflight.kubeconfig) blockers.push("kubeconfig 未就绪");
  if (!input.preflight.contextAuthorized) blockers.push("Kubernetes context 未授权");
  if (!input.preflight.namespaceReady) blockers.push("namespace 未就绪");
  if (!input.preflight.quotaReady) blockers.push("资源配额未就绪");
  if (!input.preflight.storageClassReady) blockers.push("StorageClass 未就绪");
  if (!input.preflight.imagePullSecretReady) blockers.push("镜像拉取 Secret 未就绪");
  if (!input.preflight.workerSecretReady) blockers.push("Worker Secret 未就绪");
  const canDeploy = blockers.length === 0;
  if (!input.runtime.namespaceCorrect) blockers.push("namespace 不正确");
  if (!input.runtime.rolloutComplete) blockers.push("Deployment rollout 未完成");
  if (!input.runtime.podsReady) blockers.push("Pod 尚未 Ready");
  if (!input.runtime.pvcBound) blockers.push("PVC 尚未绑定");
  if (!input.runtime.platformRegistered) blockers.push("Worker 尚未平台注册");
  if (!input.runtime.heartbeatHealthy) blockers.push("Worker 心跳异常");
  if (!input.runtime.noSideEffectClaimPassed) blockers.push("无副作用 claim 未通过");
  return { canDeploy, canFinish: canDeploy && input.runtime.namespaceCorrect && input.runtime.rolloutComplete && input.runtime.podsReady && input.runtime.pvcBound && input.runtime.platformRegistered && input.runtime.heartbeatHealthy && input.runtime.noSideEffectClaimPassed, blockers: [...new Set(blockers)] };
}

export type DockerWorkerLifecycleInput = {
  preflight: {
    dockerCli: boolean;
    imageAuthenticated: boolean;
    envReady: boolean;
    volumeReady: boolean;
    resourcesValid: boolean;
  };
  runtime: {
    containerHealthy: boolean;
    platformRegistered: boolean;
    sessionEstablished: boolean;
    heartbeatHealthy: boolean;
    capabilitiesMatched: boolean;
    noSideEffectClaimPassed: boolean;
  };
};

export function evaluateDockerWorkerLifecycle(input: DockerWorkerLifecycleInput) {
  const blockers: string[] = [];
  if (!input.preflight.dockerCli) blockers.push("Docker CLI 不可用");
  if (!input.preflight.imageAuthenticated) blockers.push("镜像仓库未登录");
  if (!input.preflight.envReady) blockers.push("环境变量或 Secret 未就绪");
  if (!input.preflight.volumeReady) blockers.push("volume 未就绪");
  if (!input.preflight.resourcesValid) blockers.push("资源配置无效");
  const canDeploy = blockers.length === 0;
  if (!input.runtime.containerHealthy) blockers.push("容器健康检查未通过");
  if (!input.runtime.platformRegistered) blockers.push("Worker 尚未平台注册");
  if (!input.runtime.sessionEstablished) blockers.push("Worker Session 未建立");
  if (!input.runtime.heartbeatHealthy) blockers.push("Worker 心跳异常");
  if (!input.runtime.capabilitiesMatched) blockers.push("Worker 能力与配置不匹配");
  if (!input.runtime.noSideEffectClaimPassed) blockers.push("无副作用 claim 未通过");
  return { canDeploy, canFinish: canDeploy && input.runtime.containerHealthy && input.runtime.platformRegistered && input.runtime.sessionEstablished && input.runtime.heartbeatHealthy && input.runtime.capabilitiesMatched && input.runtime.noSideEffectClaimPassed, blockers: [...new Set(blockers)] };
}

export function generateWorkerDeploymentCommands(input: WorkerDeploymentConfiguration) {
  const configuration = workerDeploymentConfigurationSchema.parse(input);
  validateWorkerRuntimeVariables(configuration.runtimeEnvironment);
  const name = `ht-${configuration.projectShortCode.toLowerCase()}-${configuration.poolId.slice(0, 12)}`;
  const commands = configuration.runtime === "docker"
    ? dockerCommands(configuration, name)
    : kubernetesCommands(configuration, name);
  return { runtime: configuration.runtime, name, configVersion: configuration.configVersion, commands };
}

function dockerCommands(configuration: WorkerDeploymentConfiguration, name: string) {
  const stateVolume = `${name}-state`;
  const envFile = `.humanthread/${name}.env`;
  const runtime = resolveWorkerRuntimeEnvironment(configuration.runtimeEnvironment);
  const platform = configuration.platformUrl ? ` -e HT_PLATFORM_URL=${shell(configuration.platformUrl)}` : "";
  const runtimeEnv = Object.entries(runtime.variables).map(([key, value]) => ` -e ${key}=${shell(value)}`).join("");
  const env = `-e HT_WORKER_POOL_ID=${configuration.poolId}${platform} -e HT_WORKER_RUNTIME=docker -e HT_WORKER_INSTANCE_ID=${name} -e HT_ENVIRONMENT_CONFIG_VERSION=${configuration.configVersion} -e HT_MAX_CONCURRENT_RUNS=${configuration.concurrency} -e HT_LIVE_SESSION_JOURNAL_RETENTION_DAYS=${configuration.sessionJournalRetentionDays} -e HT_WORKER_CAPABILITIES=${shell(JSON.stringify(configuration.capabilities))} -e HT_WORKER_HEALTH_PORT=${configuration.healthPort} -e HT_WORKER_TASK_ROOT=${shell(runtime.taskRoot)}${runtimeEnv}`;
  const run = (registration: string) => `docker run -d --name ${name} --restart unless-stopped --cpus ${shell(configuration.cpu)} --memory ${shell(configuration.memory)} --storage-opt size=${shell(configuration.ephemeralStorage)} --mount source=${stateVolume},target=${runtime.mountPath} ${env}${registration} ${configuration.image}`;
  const registration = configuration.poolToken && configuration.poolName
    ? ` --env-file ${shell(envFile)}`
    : "";
  const registrationFile = configuration.poolToken && configuration.poolName
    ? `mkdir -p .humanthread && umask 077 && printf 'HT_WORKER_POOL_NAME=%s\\nHT_WORKER_POOL_TOKEN=%s\\n' ${shell(configuration.poolName)} ${shell(configuration.poolToken)} > ${shell(envFile)} && `
    : "";
  return [
    { operation: "deploy" as const, command: `${registrationFile}docker volume create ${stateVolume} >/dev/null && ${run(registration)}` },
    { operation: "update" as const, command: `docker pull ${configuration.image} && docker rm -f ${name} 2>/dev/null || true && ${run(registration ? ` --env-file ${shell(envFile)}` : "")}` },
    { operation: "uninstall" as const, command: `docker rm -f ${name} 2>/dev/null || true # 持久化数据由用户挂载卷自行保留` },
  ];
}

function kubernetesCommands(configuration: WorkerDeploymentConfiguration, name: string) {
  return kubernetesCommandsGenerated(configuration, name);
}

function kubernetesCommandsGenerated(configuration: WorkerDeploymentConfiguration, name: string) {
  const ns = configuration.namespace!;
  const pvc = `${name}-data`;
  const serviceAccount = `${name}-worker`;
  const configMap = `${name}-config`;
  const workerSecret = `${name}-registration`;
  const runtime = resolveWorkerRuntimeEnvironment(configuration.runtimeEnvironment);
  const configMapValues = {
    HT_WORKER_RUNTIME: "kubernetes",
    HT_WORKER_TASK_GROUP_NAME: configuration.poolName ?? name,
    HT_ENVIRONMENT_CONFIG_VERSION: String(configuration.configVersion),
    HT_WORKER_SHARED_STORAGE: "true",
    HT_WORKER_TASK_ROOT: runtime.taskRoot,
    HT_WORKER_LOCK_MODE: "exclusive",
    HT_WORKER_IDLE_TARGET: "1",
    HT_WORKER_IDLE_WINDOW_SECONDS: "60",
    HT_WORKER_SCALE_COOLDOWN_SECONDS: "60",
    HT_MAX_CONCURRENT_RUNS: String(configuration.concurrency),
    HT_LIVE_SESSION_JOURNAL_RETENTION_DAYS: String(configuration.sessionJournalRetentionDays),
    HT_WORKER_CAPABILITIES: JSON.stringify(configuration.capabilities),
    ...runtime.variables,
  };
  const configMapData = Object.entries(configMapValues).map(([key, value]) => `  ${key}: ${JSON.stringify(value)}`).join("\n");
  const healthPort = configuration.healthPort;
  const manifest = [
    `apiVersion: v1
kind: Namespace
metadata:
  name: ${ns}`,
    `apiVersion: v1
kind: PersistentVolumeClaim
metadata:
  name: ${pvc}
  namespace: ${ns}
spec:
  accessModes: [ReadWriteMany]
  resources:
    requests:
      storage: ${configuration.persistentStorage}${configuration.storageClass ? `
  storageClassName: ${configuration.storageClass}` : ""}`,
    `apiVersion: v1
kind: ServiceAccount
metadata:
  name: ${serviceAccount}
  namespace: ${ns}`,
    `apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: ${name}
  namespace: ${ns}
rules:
  - apiGroups: [""]
    resources: ["configmaps"]
    verbs: ["get", "list", "watch"]`,
    `apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: ${name}
  namespace: ${ns}
subjects:
  - kind: ServiceAccount
    name: ${serviceAccount}
    namespace: ${ns}
roleRef:
  kind: Role
  name: ${name}
  apiGroup: rbac.authorization.k8s.io`,
    `apiVersion: v1
kind: ConfigMap
metadata:
  name: ${configMap}
  namespace: ${ns}
data:
${configMapData}`,
    `apiVersion: apps/v1
kind: Deployment
metadata:
  name: ${name}
  namespace: ${ns}
  labels:
    app: ${name}
spec:
  replicas: ${configuration.minReplicas}
  selector:
    matchLabels:
      app: ${name}
  template:
    metadata:
      labels:
        app: ${name}
    spec:
      serviceAccountName: ${serviceAccount}
      containers:
        - name: worker
          image: ${configuration.image}
          env:
            - name: HT_WORKER_POOL_ID
              value: "${configuration.poolId}"
            - name: HT_PLATFORM_URL
              value: "${configuration.platformUrl ?? "http://localhost:3000"}"
            - name: HT_WORKER_RUNTIME
              value: "kubernetes"
            - name: HT_WORKER_INSTANCE_ID
              valueFrom:
                fieldRef:
                  fieldPath: metadata.name
            - name: HT_WORKER_POOL_NAME
              valueFrom:
                secretKeyRef:
                  name: ${workerSecret}
                  key: HT_WORKER_POOL_NAME
            - name: HT_WORKER_POOL_TOKEN
              valueFrom:
                secretKeyRef:
                  name: ${workerSecret}
                  key: HT_WORKER_POOL_TOKEN
          ports:
            - name: health
              containerPort: ${healthPort}
              protocol: TCP
          readinessProbe:
            httpGet:
              path: /healthz
              port: health
          livenessProbe:
            httpGet:
              path: /healthz
              port: health
          securityContext:
            allowPrivilegeEscalation: false
          envFrom:
            - configMapRef:
                name: ${configMap}
          resources:
            requests: { cpu: "${configuration.cpu}", memory: "${configuration.memory}" }
          volumeMounts:
            - name: workspace
              mountPath: ${runtime.mountPath}
      volumes:
        - name: workspace
          persistentVolumeClaim:
            claimName: ${pvc}`,
    `apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ${name}
  namespace: ${ns}
  annotations:
    humanthread.io/idle-window-seconds: "60"
    humanthread.io/idle-workers-target: "1"
    humanthread.io/scale-cooldown-seconds: "60"
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ${name}
  minReplicas: ${configuration.minReplicas}
  maxReplicas: ${configuration.maxReplicas}
  behavior:
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
      selectPolicy: Max
    scaleDown:
      stabilizationWindowSeconds: 60
      policies:
        - type: Pods
          value: 1
          periodSeconds: 60
      selectPolicy: Min
  metrics:
    - type: Resource
      resource:
        name: cpu
        target: { type: Utilization, averageUtilization: 70 }
    - type: External
      external:
        metric:
          name: humanthread_pending_tasks
        target: { type: AverageValue, value: "1" }`,
  ].join("\n---\n");
  return [
    { operation: "deploy" as const, command: `${configuration.poolToken && configuration.poolName ? `kubectl -n ${ns} create secret generic ${workerSecret} --from-literal=HT_WORKER_POOL_NAME=${shell(configuration.poolName)} --from-literal=HT_WORKER_POOL_TOKEN=${shell(configuration.poolToken)} --dry-run=client -o yaml | kubectl apply -f - && ` : ""}kubectl apply -f - <<'YAML'\n${manifest}\nYAML` },
    { operation: "update" as const, command: `kubectl apply -f - <<'YAML'\n${manifest}\nYAML\nkubectl rollout restart deployment/${name} -n ${ns} && kubectl rollout status deployment/${name} -n ${ns}` },
    { operation: "uninstall" as const, command: `kubectl delete deployment/${name} -n ${ns} --ignore-not-found=true && kubectl delete hpa/${name} -n ${ns} --ignore-not-found=true && kubectl delete secret/${workerSecret} -n ${ns} --ignore-not-found=true # PVC ${pvc} retain，数据默认保留` },
  ];
}

function shell(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

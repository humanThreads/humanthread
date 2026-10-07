import { z } from "zod";

export const workerRuntimeEnvironmentProfiles = [
  { value: "node-npm", label: "Node.js / npm", variables: ["NPM_CONFIG_REGISTRY", "npm_config_cache"] },
  { value: "node-pnpm", label: "Node.js / pnpm", variables: ["NPM_CONFIG_REGISTRY", "COREPACK_NPM_REGISTRY", "PNPM_HOME", "npm_config_cache", "XDG_CACHE_HOME"] },
  { value: "node-yarn", label: "Node.js / yarn", variables: ["YARN_REGISTRY", "YARN_CACHE_FOLDER"] },
  { value: "python-pip", label: "Python / pip", variables: ["PIP_INDEX_URL", "PIP_CACHE_DIR"] },
  { value: "python-uv", label: "Python / uv", variables: ["UV_INDEX_URL", "UV_CACHE_DIR"] },
  { value: "java-maven", label: "Java / Maven", variables: ["MAVEN_OPTS", "MAVEN_USER_HOME"] },
  { value: "java-gradle", label: "Java / Gradle", variables: ["GRADLE_USER_HOME"] },
  { value: "go", label: "Go", variables: ["GOPROXY", "GOMODCACHE", "GOCACHE"] },
  { value: "rust", label: "Rust / Cargo", variables: ["CARGO_HOME", "RUSTUP_HOME"] },
  { value: "dotnet", label: ".NET / NuGet", variables: ["NUGET_PACKAGES", "NUGET_HTTP_CACHE_PATH"] },
  { value: "php-composer", label: "PHP / Composer", variables: ["COMPOSER_HOME", "COMPOSER_CACHE_DIR"] },
  { value: "ruby", label: "Ruby / Bundler", variables: ["BUNDLE_PATH", "GEM_HOME"] },
  { value: "custom", label: "自定义环境", variables: [] },
] as const;

export type WorkerRuntimeEnvironmentProfile = typeof workerRuntimeEnvironmentProfiles[number]["value"];

const profileSchema = z.enum(workerRuntimeEnvironmentProfiles.map((item) => item.value) as [WorkerRuntimeEnvironmentProfile, ...WorkerRuntimeEnvironmentProfile[]]);
const variableNameSchema = z.string().trim().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u, "变量名格式无效").max(191);
const absolutePathSchema = z.string().trim().regex(/^\/[A-Za-z0-9._/-]*$/u, "必须是容器内绝对路径").refine((value) => !value.includes("//") && !value.split("/").includes(".."), "路径不能包含 // 或 ..");
const relativePathSchema = z.string().trim().regex(/^\/[A-Za-z0-9._/-]*$/u, "必须使用 / 开头的相对子路径").refine((value) => value !== "/" && !value.includes("//") && !value.split("/").includes(".."), "相对子路径不能包含 //、.. 或根路径");

export const workerRuntimeVariableSchema = z.object({ name: variableNameSchema, value: z.string().trim().max(2048), pathValue: z.boolean().default(false) }).strict();
export const workerRuntimeEnvironmentSchema = z.object({
  profile: profileSchema,
  mountPath: absolutePathSchema.default("/var/lib/humanthread"),
  taskSubpath: relativePathSchema.default("/tasks"),
  variables: z.array(workerRuntimeVariableSchema).max(100),
}).strict();

export type WorkerRuntimeEnvironment = z.infer<typeof workerRuntimeEnvironmentSchema>;

const sensitiveNamePattern = /(token|password|secret|credential|authorization|cookie|dsn|api[_-]?key|private[_-]?key)/iu;
const pathVariableNames = new Set([
  "PNPM_HOME", "npm_config_cache", "XDG_CACHE_HOME", "YARN_CACHE_FOLDER", "PIP_CACHE_DIR", "UV_CACHE_DIR",
  "MAVEN_USER_HOME", "GRADLE_USER_HOME", "GOMODCACHE", "GOCACHE", "CARGO_HOME", "RUSTUP_HOME",
  "NUGET_PACKAGES", "NUGET_HTTP_CACHE_PATH", "COMPOSER_HOME", "COMPOSER_CACHE_DIR", "BUNDLE_PATH", "GEM_HOME",
]);

export function isSensitiveWorkerRuntimeVariable(name: string): boolean {
  return sensitiveNamePattern.test(name.trim());
}

export function defaultWorkerRuntimeEnvironment(profile: WorkerRuntimeEnvironmentProfile): WorkerRuntimeEnvironment {
  const preset = workerRuntimeEnvironmentProfiles.find((item) => item.value === profile);
  const defaults: Record<string, string> = {
    PNPM_HOME: "/pnpm", npm_config_cache: "/npm", XDG_CACHE_HOME: "/cache", YARN_CACHE_FOLDER: "/yarn-cache",
    PIP_CACHE_DIR: "/pip-cache", UV_CACHE_DIR: "/uv-cache", MAVEN_USER_HOME: "/maven", GRADLE_USER_HOME: "/gradle",
    GOMODCACHE: "/go-mod", GOCACHE: "/go-cache", CARGO_HOME: "/cargo", RUSTUP_HOME: "/rustup",
    NUGET_PACKAGES: "/nuget", NUGET_HTTP_CACHE_PATH: "/nuget-cache", COMPOSER_HOME: "/composer", COMPOSER_CACHE_DIR: "/composer-cache",
    BUNDLE_PATH: "/bundle", GEM_HOME: "/gems",
  };
  return workerRuntimeEnvironmentSchema.parse({
    profile,
    mountPath: "/var/lib/humanthread",
    taskSubpath: "/tasks",
    variables: (preset?.variables ?? []).map((name) => ({ name, value: defaults[name] ?? "", pathValue: pathVariableNames.has(name) })),
  });
}

export function resolveWorkerRuntimeEnvironment(input: WorkerRuntimeEnvironment): { mountPath: string; taskRoot: string; variables: Record<string, string> } {
  const configuration = workerRuntimeEnvironmentSchema.parse(input);
  const join = (suffix: string) => `${configuration.mountPath.replace(/\/$/u, "")}${suffix}`;
  const variables: Record<string, string> = {};
  for (const variable of configuration.variables) {
    if (!variable.value) continue;
    variables[variable.name] = variable.pathValue || pathVariableNames.has(variable.name) ? join(variable.value) : variable.value;
  }
  return { mountPath: configuration.mountPath, taskRoot: join(configuration.taskSubpath), variables };
}

export function validateWorkerRuntimeVariables(input: WorkerRuntimeEnvironment): void {
  const configuration = workerRuntimeEnvironmentSchema.parse(input);
  const seen = new Set<string>();
  for (const variable of configuration.variables) {
    if (seen.has(variable.name)) throw new Error(`Worker 运行变量重复：${variable.name}`);
    seen.add(variable.name);
    if (isSensitiveWorkerRuntimeVariable(variable.name)) throw new Error(`${variable.name} 属于敏感凭证，请转到环境与凭证配置`);
    if ((variable.pathValue || pathVariableNames.has(variable.name)) && variable.value) relativePathSchema.parse(variable.value);
  }
  const resolved = resolveWorkerRuntimeEnvironment(configuration);
  const paths = [resolved.taskRoot, ...Object.entries(resolved.variables).filter(([name]) => pathVariableNames.has(name)).map(([, value]) => value)];
  if (new Set(paths).size !== paths.length) throw new Error("Worker 任务目录和缓存目录不能重复");
}

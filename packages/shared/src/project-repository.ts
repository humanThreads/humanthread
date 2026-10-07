import { z } from "zod";

export const projectRepositoryProviderSchema = z.enum(["github", "gitlab", "private"]);
export const projectRepositoryCreationModeSchema = z.enum(["new", "existing"]);
export const projectRepositoryAuthModeSchema = z.enum(["account_password", "project_token"]);
export const repositoryVerificationStatusSchema = z.enum([
  "pending_verification",
  "passed",
  "failed",
  "executor_not_configured",
]);

export const repositoryVerificationFailureCodeSchema = z.enum([
  "provider_unsupported",
  "private_host_not_allowed",
  "repository_not_found",
  "credential_rejected",
  "permission_denied",
  "default_branch_unavailable",
  "verification_timeout",
  "executor_not_configured",
  "secret_cleanup_failed",
  "verification_failed",
]);

export const repositoryVerificationResultSchema = z.object({
  status: repositoryVerificationStatusSchema,
  verifiedAt: z.string().datetime().nullable(),
  defaultBranch: z.string().trim().min(1).max(191).nullable(),
  headSha: z.string().regex(/^[a-f0-9]{40,64}$/u).nullable(),
  failureCode: repositoryVerificationFailureCodeSchema.nullable(),
  apiChecked: z.boolean(),
}).strict();

export const projectRepositoryConfigurationSchema = z.object({
  schemaVersion: z.literal(1),
  provider: projectRepositoryProviderSchema,
  creationMode: projectRepositoryCreationModeSchema,
  privateBaseUrl: z.string().max(1024).nullable(),
  privateWebUrl: z.string().max(1024).nullable(),
  privateTokenHelpUrl: z.string().max(1024).nullable(),
  authMode: projectRepositoryAuthModeSchema,
  verification: repositoryVerificationResultSchema,
}).strict();

export const projectRepositoryCredentialInputSchema = z.object({
  authMode: projectRepositoryAuthModeSchema,
  username: z.string().trim().max(191).optional().default(""),
  secret: z.string().min(1).max(32_768),
}).strict();

export const repositoryVerificationJobSchema = z.object({
  projectId: z.string().trim().min(1).max(96),
  expectedVersion: z.number().int().positive(),
  expectedDefaultBranch: z.string().trim().min(1).max(191).optional(),
}).strict();

export type ProjectRepositoryProvider = z.infer<typeof projectRepositoryProviderSchema>;
export type ProjectRepositoryCreationMode = z.infer<typeof projectRepositoryCreationModeSchema>;
export type ProjectRepositoryAuthMode = z.infer<typeof projectRepositoryAuthModeSchema>;
export type RepositoryVerificationFailureCode = z.infer<typeof repositoryVerificationFailureCodeSchema>;
export type RepositoryVerificationResult = z.infer<typeof repositoryVerificationResultSchema>;
export type ProjectRepositoryConfiguration = z.infer<typeof projectRepositoryConfigurationSchema>;
export type ProjectRepositoryCredentialInput = z.infer<typeof projectRepositoryCredentialInputSchema>;
export type RepositoryVerificationJob = z.infer<typeof repositoryVerificationJobSchema>;

export type ProviderRepositoryLinks = {
  createRepositoryUrl: string | null;
  repositoryListUrl: string | null;
  createTokenUrl: string | null;
  defaultUsername: string;
  tokenLabel: string;
  tokenPermissions: string[];
};

function normalizedHttpsUrl(value: string, input: { allowPath: boolean; field: string }): URL {
  const raw = value.trim();
  if (!raw || raw.length > 1024 || /[\u0000-\u001f\u007f\s]/u.test(raw)) throw new Error(`${input.field} 无效`);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error(`${input.field} 无效`);
  }
  if (parsed.protocol !== "https:") throw new Error(`${input.field} 必须使用 HTTPS`);
  if (parsed.username || parsed.password) throw new Error(`${input.field} 不允许包含 userinfo`);
  if (parsed.search || parsed.hash) throw new Error(`${input.field} 不允许包含 query 或 fragment`);
  if (!input.allowPath && parsed.pathname !== "/" && parsed.pathname !== "") throw new Error(`${input.field} 必须是站点根地址`);
  return parsed;
}

export function normalizeProjectRepositoryUrl(value: string): string {
  const parsed = normalizedHttpsUrl(value, { allowPath: true, field: "Git 仓库地址" });
  const pathname = parsed.pathname.replace(/\/+$/u, "");
  if (!pathname || pathname === "/") throw new Error("Git 仓库地址缺少仓库路径");
  return `${parsed.origin}${pathname}`;
}

export function normalizePrivateRepositoryBaseUrl(value: string): string {
  const parsed = normalizedHttpsUrl(value, { allowPath: false, field: "私仓地址" });
  return parsed.origin;
}

function normalizePrivateRepositoryPageUrl(value: string, field: string): string {
  const parsed = normalizedHttpsUrl(value, { allowPath: true, field });
  const pathname = parsed.pathname.replace(/\/+$/u, "");
  return `${parsed.origin}${pathname === "/" ? "" : pathname}`;
}

export function repositoryHost(value: string): string {
  return new URL(normalizeProjectRepositoryUrl(value)).hostname.toLowerCase();
}

export function repositorySshUrl(value: string): string {
  const parsed = new URL(normalizeProjectRepositoryUrl(value));
  const path = parsed.pathname.replace(/^\/+/u, "").replace(/\/+$/u, "");
  const sshPath = path.endsWith(".git") ? path : `${path}.git`;
  return parsed.port
    ? `ssh://git@${parsed.hostname}:${parsed.port}/${sshPath}`
    : `git@${parsed.hostname}:${sshPath}`;
}

export function defaultGitUsername(provider: ProjectRepositoryProvider): string {
  return provider === "github" ? "x-access-token" : "oauth2";
}

export function providerRepositoryLinks(input: {
  provider: ProjectRepositoryProvider;
  privateBaseUrl?: string | null;
  privateWebUrl?: string | null;
  privateTokenHelpUrl?: string | null;
}): ProviderRepositoryLinks {
  if (input.provider === "github") {
    return {
      createRepositoryUrl: "https://github.com/new",
      repositoryListUrl: "https://github.com/settings/repositories",
      createTokenUrl: "https://github.com/settings/personal-access-tokens/new",
      defaultUsername: defaultGitUsername("github"),
      tokenLabel: "Fine-grained personal access token",
      tokenPermissions: ["Metadata: read", "Contents: read", "交付时 Contents: read/write", "交付时 Pull requests: read/write", "交付时 Actions: read"],
    };
  }
  if (input.provider === "gitlab") {
    return {
      createRepositoryUrl: "https://gitlab.com/projects/new",
      repositoryListUrl: "https://gitlab.com/dashboard/projects",
      createTokenUrl: "https://gitlab.com/-/user_settings/personal_access_tokens",
      defaultUsername: defaultGitUsername("gitlab"),
      tokenLabel: "Project Access Token",
      tokenPermissions: ["read_repository", "write_repository", "Merge Request 自动化时增加 api"],
    };
  }
  const baseUrl = input.privateBaseUrl ? normalizePrivateRepositoryBaseUrl(input.privateBaseUrl) : null;
  const webUrl = input.privateWebUrl ? normalizePrivateRepositoryPageUrl(input.privateWebUrl, "私仓 Web 地址") : null;
  const tokenHelpUrl = input.privateTokenHelpUrl ? normalizePrivateRepositoryPageUrl(input.privateTokenHelpUrl, "私仓 Token 帮助地址") : null;
  return {
    createRepositoryUrl: baseUrl ? `${baseUrl}/projects/new` : null,
    repositoryListUrl: webUrl ?? baseUrl,
    createTokenUrl: tokenHelpUrl,
    defaultUsername: defaultGitUsername("private"),
    tokenLabel: "项目 Token",
    tokenPermissions: ["read_repository", "write_repository", "由私仓管理员确认额外权限"],
  };
}

export function repositoryCredentialSecretNames(authMode: ProjectRepositoryAuthMode): string[] {
  return authMode === "project_token"
    ? ["HT_GIT_USERNAME", "HT_GIT_TOKEN"]
    : ["HT_GIT_USERNAME", "HT_GIT_PASSWORD"];
}

export function normalizeGitCredentialEnvironment(input: {
  provider: ProjectRepositoryProvider;
  authMode: ProjectRepositoryAuthMode;
  username: string;
  secret: string;
}): Pick<Record<string, string>, "HT_GIT_USERNAME" | "HT_GIT_SECRET"> {
  const secret = input.secret.trim();
  if (!secret || secret.length > 32_768) throw new Error("Git 凭证值无效");
  if (input.authMode === "account_password" && input.provider === "github") {
    throw new Error("GitHub 不支持账户密码，请使用 Fine-grained personal access token");
  }
  const username = input.username.trim() || (input.authMode === "project_token" ? defaultGitUsername(input.provider) : "");
  if (!username) throw new Error("账户密码模式必须填写 Git 用户名");
  if (username.length > 191 || /[\u0000-\u001f\u007f\r\n]/u.test(username)) throw new Error("Git 用户名无效");
  return { HT_GIT_USERNAME: username, HT_GIT_SECRET: secret };
}

export function projectRepositoryRequiresGit(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Reflect.get(value, "requireGitDelivery") === true);
}

import { describe, expect, it, vi } from "vitest";

import {
  createGitRepositoryVerificationExecutor,
  createRepositoryVerificationHandler,
  parseGitLsRemote,
  type RepositoryVerificationDependencies,
} from "./repository-verification";

const configuration = {
  schemaVersion: 1,
  provider: "github",
  creationMode: "existing",
  privateBaseUrl: null,
  privateWebUrl: null,
  privateTokenHelpUrl: null,
  authMode: "project_token",
  verification: { status: "pending_verification", verifiedAt: null, defaultBranch: null, headSha: null, failureCode: null, apiChecked: false },
} as const;

function fixture(overrides: Partial<RepositoryVerificationDependencies> = {}) {
  const dependencies: RepositoryVerificationDependencies = {
    loadTarget: vi.fn().mockResolvedValue({
      projectId: "project_1",
      version: 4,
      repositoryUrl: "https://github.com/acme/repo.git",
      configuration,
    }),
    resolveSecrets: vi.fn().mockResolvedValue({ HT_GIT_USERNAME: "x-access-token", HT_GIT_TOKEN: "secret-token" }),
    saveVerification: vi.fn().mockResolvedValue({ projectId: "project_1", version: 5 }),
    executor: vi.fn().mockResolvedValue({ defaultBranch: "main", headSha: "a".repeat(40) }),
    privateHostAllowlist: [],
    now: () => new Date("2026-09-28T12:30:00.000Z"),
    ...overrides,
  };
  return dependencies;
}

describe("parseGitLsRemote", () => {
  it("extracts the symbolic default branch and HEAD commit", () => {
    expect(parseGitLsRemote([
      "ref: refs/heads/main\tHEAD",
      `${"a".repeat(40)}\tHEAD`,
      "",
    ].join("\n"))).toEqual({ defaultBranch: "main", headSha: "a".repeat(40) });
  });
});

describe("createGitRepositoryVerificationExecutor", () => {
  it("runs fixed Git arguments and removes temporary credentials", async () => {
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const runGit = vi.fn(async (args: string[], options: { env: NodeJS.ProcessEnv }) => {
      calls.push({ args, env: options.env });
      if (args[0] === "ls-remote") return { stdout: `ref: refs/heads/main\tHEAD\n${"b".repeat(40)}\tHEAD\n` };
      if (args.includes("rev-parse")) return { stdout: `${"b".repeat(40)}\n` };
      return { stdout: "" };
    });
    const removePath = vi.fn().mockResolvedValue(undefined);
    const executor = createGitRepositoryVerificationExecutor({
      runGit,
      createTempDirectory: vi.fn().mockResolvedValue("/tmp/ht-repository-verify"),
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
      removePath,
    });

    await expect(executor({
      repositoryUrl: "https://github.com/acme/repo.git",
      provider: "github",
      authMode: "project_token",
      username: "x-access-token",
      secret: "secret-token",
    })).resolves.toEqual({ defaultBranch: "main", headSha: "b".repeat(40) });

    expect(calls[0]?.args).toEqual(["ls-remote", "--symref", "https://github.com/acme/repo.git", "HEAD"]);
    expect(calls.some((call) => call.args.includes("fetch") && call.args.includes("--depth=1"))).toBe(true);
    expect(calls.every((call) => call.args.every((argument) => !argument.includes("secret-token")))).toBe(true);
    expect(calls[0]?.env).toMatchObject({ HT_GIT_USERNAME: "x-access-token", HT_GIT_SECRET: "secret-token" });
    expect(removePath).toHaveBeenCalledWith("/tmp/ht-repository-verify");
  });

  it("classifies authentication failures without leaking raw Git stderr", async () => {
    const executor = createGitRepositoryVerificationExecutor({
      runGit: vi.fn().mockRejectedValue(Object.assign(new Error("Authorization: Basic secret-token"), { code: "credential_rejected" })),
      createTempDirectory: vi.fn().mockResolvedValue("/tmp/ht-repository-verify"),
      writePrivateFile: vi.fn().mockResolvedValue(undefined),
      removePath: vi.fn().mockResolvedValue(undefined),
    });

    await expect(executor({
      repositoryUrl: "https://github.com/acme/repo.git",
      provider: "github",
      authMode: "project_token",
      username: "x-access-token",
      secret: "secret-token",
    })).rejects.toMatchObject({ code: "credential_rejected", message: "Git repository authentication was rejected" });
  });
});

describe("createRepositoryVerificationHandler", () => {
  it("persists a passed verification after the controlled executor succeeds", async () => {
    const dependencies = fixture();
    await createRepositoryVerificationHandler(dependencies)({ projectId: "project_1", expectedVersion: 4, expectedDefaultBranch: "main" });

    expect(dependencies.executor).toHaveBeenCalledWith(expect.objectContaining({
      repositoryUrl: "https://github.com/acme/repo.git",
      secret: "secret-token",
    }));
    expect(dependencies.saveVerification).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project_1",
      expectedVersion: 4,
      verification: expect.objectContaining({ status: "passed", defaultBranch: "main", verifiedAt: "2026-09-28T12:30:00.000Z" }),
    }));
  });

  it("does not run Git for a stale task version", async () => {
    const dependencies = fixture({ loadTarget: vi.fn().mockResolvedValue(null) });
    await createRepositoryVerificationHandler(dependencies)({ projectId: "project_1", expectedVersion: 3 });

    expect(dependencies.executor).not.toHaveBeenCalled();
    expect(dependencies.saveVerification).not.toHaveBeenCalled();
  });

  it("rejects a private host outside the allowlist without executing Git", async () => {
    const dependencies = fixture({
      loadTarget: vi.fn().mockResolvedValue({
        projectId: "project_1",
        version: 4,
        repositoryUrl: "https://git.internal.example/acme/repo.git",
        configuration: { ...configuration, provider: "private", privateBaseUrl: "https://git.internal.example" },
      }),
      privateHostAllowlist: ["git.allowed.example"],
      executor: vi.fn(),
    });
    await createRepositoryVerificationHandler(dependencies)({ projectId: "project_1", expectedVersion: 4 });

    expect(dependencies.executor).not.toHaveBeenCalled();
    expect(dependencies.resolveSecrets).not.toHaveBeenCalled();
    expect(dependencies.saveVerification).toHaveBeenCalledWith(expect.objectContaining({
      verification: expect.objectContaining({ status: "failed", failureCode: "private_host_not_allowed" }),
    }));
  });

  it("fails closed with a safe code when credentials are missing", async () => {
    const dependencies = fixture({ resolveSecrets: vi.fn().mockResolvedValue({}) });
    await createRepositoryVerificationHandler(dependencies)({ projectId: "project_1", expectedVersion: 4 });

    expect(dependencies.executor).not.toHaveBeenCalled();
    expect(dependencies.saveVerification).toHaveBeenCalledWith(expect.objectContaining({
      verification: expect.objectContaining({ status: "failed", failureCode: "credential_rejected" }),
    }));
  });

  it("records only the stable failure code and never the raw error", async () => {
    const dependencies = fixture({ executor: vi.fn().mockRejectedValue(new Error("Authorization: Bearer secret-token")) });
    const result = await createRepositoryVerificationHandler(dependencies)({ projectId: "project_1", expectedVersion: 4 });

    expect(result).toBeUndefined();
    expect(JSON.stringify(vi.mocked(dependencies.saveVerification).mock.calls)).toContain("verification_failed");
    expect(JSON.stringify(vi.mocked(dependencies.saveVerification).mock.calls)).not.toContain("secret-token");
  });

  it("discards a completed result when the Project changed while Git was running", async () => {
    const dependencies = fixture({
      saveVerification: vi.fn().mockRejectedValue(Object.assign(new Error("Project changed"), { code: "version_conflict" })),
    });

    await expect(createRepositoryVerificationHandler(dependencies)({
      projectId: "project_1",
      expectedVersion: 4,
    })).resolves.toBeUndefined();
  });
});

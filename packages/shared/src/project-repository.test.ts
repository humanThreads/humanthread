import { describe, expect, it } from "vitest";

import {
  defaultGitUsername,
  normalizeGitCredentialEnvironment,
  normalizeProjectRepositoryUrl,
  providerRepositoryLinks,
  repositoryCredentialSecretNames,
  repositoryVerificationJobSchema,
  repositorySshUrl,
} from "./project-repository";

describe("project repository contract", () => {
  it("rejects credential-bearing and non-HTTPS repository URLs", () => {
    expect(() => normalizeProjectRepositoryUrl("https://user:secret@github.com/acme/repo.git")).toThrow(/userinfo/u);
    expect(() => normalizeProjectRepositoryUrl("http://gitlab.com/acme/repo.git")).toThrow(/HTTPS/u);
    expect(() => normalizeProjectRepositoryUrl("https://github.com/acme/repo.git?token=secret")).toThrow(/query/u);
    expect(normalizeProjectRepositoryUrl("https://github.com/acme/repo.git/")).toBe("https://github.com/acme/repo.git");
  });

  it("provides provider-specific creation, token, and permission guidance", () => {
    expect(providerRepositoryLinks({ provider: "github" })).toMatchObject({
      createRepositoryUrl: "https://github.com/new",
      createTokenUrl: "https://github.com/settings/personal-access-tokens/new",
      defaultUsername: "x-access-token",
      tokenLabel: "Fine-grained personal access token",
    });
    expect(providerRepositoryLinks({ provider: "gitlab" })).toMatchObject({
      createRepositoryUrl: "https://gitlab.com/projects/new",
      defaultUsername: "oauth2",
      tokenLabel: "Project Access Token",
    });
    expect(providerRepositoryLinks({
      provider: "private",
      privateBaseUrl: "https://git.example.com",
      privateWebUrl: "https://code.example.com",
      privateTokenHelpUrl: "https://code.example.com/help/tokens",
    })).toMatchObject({
      createRepositoryUrl: "https://git.example.com/projects/new",
      createTokenUrl: "https://code.example.com/help/tokens",
      defaultUsername: "oauth2",
    });
  });

  it("builds a credential-free SSH address from the HTTPS repository address", () => {
    expect(repositorySshUrl("https://github.com/acme/repo.git")).toBe("git@github.com:acme/repo.git");
    expect(repositorySshUrl("https://git.example.com/group/sub/repo")).toBe("git@git.example.com:group/sub/repo.git");
  });

  it("maps token and password credentials without exposing the mode", () => {
    expect(defaultGitUsername("github")).toBe("x-access-token");
    expect(defaultGitUsername("gitlab")).toBe("oauth2");
    expect(repositoryCredentialSecretNames("project_token")).toEqual(["HT_GIT_USERNAME", "HT_GIT_TOKEN"]);
    expect(repositoryCredentialSecretNames("account_password")).toEqual(["HT_GIT_USERNAME", "HT_GIT_PASSWORD"]);
    expect(normalizeGitCredentialEnvironment({
      provider: "github",
      authMode: "project_token",
      username: "",
      secret: "token-value",
    })).toEqual({ HT_GIT_USERNAME: "x-access-token", HT_GIT_SECRET: "token-value" });
    expect(normalizeGitCredentialEnvironment({
      provider: "private",
      authMode: "account_password",
      username: "deploy",
      secret: "password-value",
    })).toEqual({ HT_GIT_USERNAME: "deploy", HT_GIT_SECRET: "password-value" });
  });

  it("requires a password username and rejects GitHub password mode", () => {
    expect(() => normalizeGitCredentialEnvironment({
      provider: "github",
      authMode: "account_password",
      username: "user",
      secret: "password",
    })).toThrow(/GitHub/u);
    expect(() => normalizeGitCredentialEnvironment({
      provider: "private",
      authMode: "account_password",
      username: "",
      secret: "password",
    })).toThrow(/用户名/u);
  });

  it("keeps verification jobs strict and version fenced", () => {
    expect(repositoryVerificationJobSchema.parse({
      projectId: "project_1",
      expectedVersion: 4,
      expectedDefaultBranch: "main",
    })).toEqual({ projectId: "project_1", expectedVersion: 4, expectedDefaultBranch: "main" });
    expect(repositoryVerificationJobSchema.safeParse({ projectId: "project_1", expectedVersion: 0 }).success).toBe(false);
    expect(repositoryVerificationJobSchema.safeParse({ projectId: "project_1", expectedVersion: 4, token: "secret" }).success).toBe(false);
  });
});

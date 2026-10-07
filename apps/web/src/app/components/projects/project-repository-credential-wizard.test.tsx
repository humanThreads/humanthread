// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectRepositoryCredentialWizard } from "./project-repository-credential-wizard";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("ProjectRepositoryCredentialWizard", () => {
  it("shows provider links, disables GitHub password authentication, and opens the copy dialog", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      ok: true,
      result: {
        projectId: "project_1",
        version: 3,
        repositoryUrl: null,
        branchPolicy: null,
        configuration: null,
        credentials: [],
      },
    })));

    render(<ProjectRepositoryCredentialWizard projectId="project_1" version={3} canEdit />);

    await screen.findByRole("button", { name: "下一步" });
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.type(screen.getByLabelText("Git 仓库地址"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "复制仓库地址" }));

    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByText("https://github.com/acme/repo.git")).toBeTruthy();
    expect(screen.getByText("git@github.com:acme/repo.git")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "复制SSH地址" }));
    expect(writeText).toHaveBeenCalledWith("git@github.com:acme/repo.git");

    await user.click(screen.getByRole("button", { name: "关闭复制仓库地址" }));
    await user.click(screen.getByRole("button", { name: "下一步" }));
    expect(screen.getByRole("button", { name: "账户密码" }).hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/GitHub 不支持 Git HTTPS 账户密码/u)).toBeTruthy();
  });

  it("saves credentials, queues verification, and polls the persisted result without receiving the secret back", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: { projectId: "project_1", version: 3, repositoryUrl: null, branchPolicy: null, configuration: null, credentials: [] },
      }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { projectId: "project_1", version: 4 } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, result: { credentialNames: ["HT_GIT_TOKEN", "HT_GIT_USERNAME"] } }, 201))
      .mockResolvedValueOnce(jsonResponse({ ok: true, accepted: true, result: { projectId: "project_1", version: 5, status: "pending_verification" } }, 202))
      .mockResolvedValueOnce(jsonResponse({
        ok: true,
        result: {
          projectId: "project_1",
          version: 6,
          repositoryUrl: "https://github.com/acme/repo.git",
          branchPolicy: { allowedBranches: ["main"] },
          configuration: {
            schemaVersion: 1,
            provider: "github",
            creationMode: "existing",
            privateBaseUrl: null,
            privateWebUrl: null,
            privateTokenHelpUrl: null,
            authMode: "project_token",
            verification: { status: "passed", verifiedAt: "2026-09-28T12:30:00.000Z", defaultBranch: "main", headSha: "a".repeat(40), failureCode: null, apiChecked: false },
          },
          credentials: [{ name: "HT_GIT_TOKEN", status: "configured" }, { name: "HT_GIT_USERNAME", status: "configured" }],
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const secret = ["unit", "test", "token"].join("-");

    render(<ProjectRepositoryCredentialWizard projectId="project_1" version={3} canEdit />);

    await screen.findByRole("button", { name: "下一步" });
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.type(screen.getByLabelText("Git 仓库地址"), "https://github.com/acme/repo.git");
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.type(screen.getByLabelText("Git 凭证"), secret);
    await user.click(screen.getByRole("button", { name: "下一步" }));
    await user.click(screen.getByRole("button", { name: "保存并校验" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    expect(await screen.findByText("已校验")).toBeTruthy();
    expect(screen.queryByText(secret)).toBeNull();
    expect(fetchMock).toHaveBeenNthCalledWith(3, "/api/projects/project_1/repository-credentials", expect.objectContaining({
      body: JSON.stringify({ authMode: "project_token", username: "", secret }),
    }));
    expect(fetchMock).toHaveBeenNthCalledWith(4, "/api/projects/project_1/repository-verification", expect.objectContaining({
      method: "POST",
    }));
  });
});

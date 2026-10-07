import { describe, expect, it, vi } from "vitest";

import { createProjectLoopApi } from "./project-loop-api";

describe("createProjectLoopApi", () => {
  it("fetches and validates the project catalog with its logged-in session", async () => {
    const fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({
        ok: true,
        result: {
          contractVersion: 2,
          projectId: "project_1",
          catalogVersion: `sha256:${"a".repeat(64)}`,
          projectBindings: [],
          publishedLoops: [],
        },
      }),
    });
    const api = createProjectLoopApi({ baseUrl: "http://localhost:3000/", accessToken: "v1.access.signature" }, { fetch });

    await expect(api.readCatalog("project_1")).resolves.toMatchObject({ projectId: "project_1" });
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:3000/api/cli/projects/project_1/loop-catalog",
      expect.objectContaining({ headers: { authorization: "Bearer v1.access.signature" } }),
    );
  });

  it("rejects an invalid catalog before local writes", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ ok: true, result: {} }) });
    const api = createProjectLoopApi({ baseUrl: "http://localhost:3000", accessToken: "v1.access.signature" }, { fetch });
    await expect(api.readCatalog("project_1")).rejects.toMatchObject({ code: "invalid_loop_catalog" });
  });
});

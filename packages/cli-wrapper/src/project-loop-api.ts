import { projectLoopCatalogV2Schema, type ProjectLoopCatalogV2 } from "@humanthread/project-loop-sync";

export type ProjectLoopApiCredentials = {
  baseUrl: string;
  accessToken: string;
};

function apiError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export function createProjectLoopApi(
  credentials: ProjectLoopApiCredentials,
  dependencies: { fetch?: typeof fetch } = {},
): { readCatalog(projectId: string): Promise<ProjectLoopCatalogV2> } {
  const request = dependencies.fetch ?? fetch;
  const baseUrl = credentials.baseUrl.replace(/\/+$/u, "");
  return {
    async readCatalog(projectId) {
      const response = await request(
        `${baseUrl}/api/cli/projects/${encodeURIComponent(projectId)}/loop-catalog`,
        { headers: { authorization: `Bearer ${credentials.accessToken}` } },
      );
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw apiError("loop_catalog_unavailable", `Loop catalog request failed: HTTP ${response.status}`);
      }
      if (!response.ok || !payload || typeof payload !== "object" || Reflect.get(payload, "ok") !== true) {
        const message = payload && typeof payload === "object" && typeof Reflect.get(payload, "error") === "string"
          ? String(Reflect.get(payload, "error"))
          : `Loop catalog request failed: HTTP ${response.status}`;
        throw apiError("loop_catalog_unavailable", message);
      }
      const parsed = projectLoopCatalogV2Schema.safeParse(Reflect.get(payload, "result"));
      if (!parsed.success || parsed.data.projectId !== projectId) {
        throw apiError("invalid_loop_catalog", "Platform returned an invalid Loop catalog");
      }
      return parsed.data;
    },
  };
}

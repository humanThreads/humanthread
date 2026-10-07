import {
  initializeProjectLoops,
  readProjectLoopInitializationState,
  type ProjectLoopCatalogV2,
  type ProjectLoopSyncFilesystem,
} from "@humanthread/project-loop-sync";

function initError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function runHtInit(
  input: { cwd: string; projectId?: string },
  dependencies: {
    fs: ProjectLoopSyncFilesystem;
    readCatalog(projectId: string): Promise<ProjectLoopCatalogV2>;
    now?: () => Date;
  },
) {
  const previousState = await readProjectLoopInitializationState(dependencies.fs);
  const projectId = previousState.manifest?.projectId ?? input.projectId?.trim();
  if (!projectId) throw initError("project_identity_required", "Run ht init --project <projectId>");
  const catalog = await dependencies.readCatalog(projectId);
  return initializeProjectLoops({
    fs: dependencies.fs,
    catalog,
    previousState,
    now: (dependencies.now ?? (() => new Date()))(),
  });
}

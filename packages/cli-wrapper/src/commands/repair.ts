import {
  createStagePackageFileGroup,
  projectLoopLockV2Schema,
  type ProjectLoopSyncFilesystem,
} from "@humanthread/project-loop-sync";

import { parseStageId } from "./stage-identity";

function repairError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function runHtRepair(
  input: { cwd: string; stageId: string },
  dependencies: { fs: ProjectLoopSyncFilesystem },
) {
  const lockText = await dependencies.fs.readText(".humanthread/structure/lock.json");
  if (lockText === null) throw repairError("project_not_initialized", "Run ht init before ht repair");
  let lock;
  try { lock = projectLoopLockV2Schema.parse(JSON.parse(lockText)); } catch { throw repairError("local_structure_invalid", "Loop lockfile is invalid"); }
  const identity = parseStageId(input.stageId);
  const matches = Object.entries(lock.subloops).filter(([, entry]) => (
    entry.parentLoopId === identity.loopId && entry.stableId === identity.subloopId
  ));
  if (matches.length !== 1) throw repairError("stage_not_found", `Unknown local Stage: ${input.stageId}`);
  const [entryKey, entry] = matches[0]!;
  if (entry.state !== "missing") throw repairError("stage_not_missing", `Stage is not marked missing: ${input.stageId}`);
  const group = createStagePackageFileGroup({
    loopId: identity.loopId,
    subloopId: identity.subloopId,
    path: entry.path,
    label: identity.subloopId,
  });
  for (const directory of group.directories) await dependencies.fs.mkdir(directory);
  const createdFiles: string[] = [];
  for (const file of group.files) {
    if (await dependencies.fs.readText(file.path) !== null) continue;
    await dependencies.fs.writeTextExclusive(file.path, file.content);
    createdFiles.push(file.path);
  }
  lock.subloops[entryKey] = {
    ...entry,
    expectedFiles: group.files.map(({ path }) => path),
    state: "unconfigured",
  };
  await dependencies.fs.writeTextAtomic(".humanthread/structure/lock.json", `${JSON.stringify(lock, null, 2)}\n`);
  return { stageId: input.stageId, state: "unconfigured" as const, createdFiles };
}

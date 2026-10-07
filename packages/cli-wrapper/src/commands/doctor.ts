import {
  projectLoopLockSchema,
  projectLoopLockV2Schema,
  projectLoopManifestSchema,
  projectLoopManifestV2Schema,
  validateProjectLoopReadiness,
  type ProjectLoopSyncFilesystem,
} from "@humanthread/project-loop-sync";

function doctorError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function runHtDoctor(
  _input: { cwd: string },
  dependencies: { fs: ProjectLoopSyncFilesystem },
) {
  const [manifestText, lockText] = await Promise.all([
    dependencies.fs.readText(".humanthread/structure/manifest.json"),
    dependencies.fs.readText(".humanthread/structure/lock.json"),
  ]);
  if (manifestText === null || lockText === null) throw doctorError("project_not_initialized", "Run ht init before ht doctor");
  try {
    const manifestValue: unknown = JSON.parse(manifestText);
    const lockValue: unknown = JSON.parse(lockText);
    if (lockValue && typeof lockValue === "object" && Reflect.get(lockValue, "schemaVersion") === 2) {
      return await validateProjectLoopReadiness({
        manifest: projectLoopManifestV2Schema.parse(manifestValue),
        lock: projectLoopLockV2Schema.parse(lockValue),
        readText: (path) => dependencies.fs.readText(path),
        listTree: (path) => dependencies.fs.listTree(path),
      });
    }
    return await validateProjectLoopReadiness({
      manifest: projectLoopManifestSchema.parse(manifestValue),
      lock: projectLoopLockSchema.parse(lockValue),
      readText: (path) => dependencies.fs.readText(path),
    });
  } catch (error) {
    if (error && typeof error === "object" && typeof Reflect.get(error, "code") === "string") throw error;
    throw doctorError("local_structure_invalid", "Local Loop structure is invalid");
  }
}

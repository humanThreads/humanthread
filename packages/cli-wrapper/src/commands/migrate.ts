import {
  createStagePackageFileGroup,
  explicitV1MigrationReportPath,
  explicitV1MigrationReportSchema,
  explicitV1MigrationStageSegment,
  explicitV1MigrationTransactionId,
  projectLoopLockSchema,
  type ProjectLoopSyncFilesystem,
} from "@humanthread/project-loop-sync";

import { parseStageId } from "./stage-identity";

function migrationError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export async function runHtMigrate(
  input: { cwd: string; stageId: string },
  dependencies: { fs: ProjectLoopSyncFilesystem; now?: () => Date },
) {
  const lockText = await dependencies.fs.readText(".humanthread/structure/lock.json");
  if (lockText === null) throw migrationError("project_not_initialized", "Run ht init before ht migrate");
  let lock;
  try { lock = projectLoopLockSchema.parse(JSON.parse(lockText)); } catch { throw migrationError("local_structure_invalid", "Loop lockfile is invalid or is already v2"); }
  const identity = parseStageId(input.stageId);
  const matches = Object.values(lock.nodes).filter((entry) => (
    entry.parentLoopId === identity.loopId && entry.stableId === identity.subloopId
  ));
  if (matches.length !== 1) throw migrationError("stage_not_found", `Unknown local v1 Stage: ${input.stageId}`);
  const entry = matches[0]!;
  if (entry.state !== "migration_required") {
    throw migrationError("migration_not_required", `Stage is not marked migration_required: ${input.stageId}`);
  }
  const loop = lock.loops[identity.loopId];
  if (!loop) throw migrationError("stage_identity_mismatch", `Stage has no local parent Loop: ${input.stageId}`);
  if (!entry.path.startsWith(".humanthread/")) throw migrationError("workspace_scope_denied", "The v1 Stage path is outside .humanthread");

  const stagePath = `${loop.path}/subloops/${explicitV1MigrationStageSegment(identity.subloopId)}`;
  const backupPath = `.humanthread/runtime/sync/${explicitV1MigrationTransactionId(identity.loopId, identity.subloopId)}/backup/${entry.path.slice(".humanthread/".length)}`;
  const reportPath = explicitV1MigrationReportPath(identity.loopId, identity.subloopId);
  const [sourceFiles, backupFiles] = await Promise.all([
    dependencies.fs.listTree(entry.path),
    dependencies.fs.listTree(backupPath),
  ]);
  if (sourceFiles.length > 0 && backupFiles.length > 0) {
    throw migrationError("migration_transaction_conflict", `Both migration source and backup exist: ${entry.path}`);
  }
  if (sourceFiles.length === 0 && backupFiles.length === 0) {
    throw migrationError("migration_source_missing", `Migration source and backup are both missing: ${entry.path}`);
  }
  const readBase = sourceFiles.length > 0 ? entry.path : backupPath;
  const [legacyRules, legacyPrompt, legacySchema] = await Promise.all([
    dependencies.fs.readText(`${readBase}/rules.md`),
    dependencies.fs.readText(`${readBase}/prompt.md`),
    dependencies.fs.readText(`${readBase}/schemas/output.schema.json`),
  ]);
  if (legacyRules === null || legacyPrompt === null || legacySchema === null) {
    throw migrationError("migration_source_invalid", `The v1 Stage is missing required files: ${input.stageId}`);
  }

  const group = createStagePackageFileGroup({
    loopId: identity.loopId,
    subloopId: identity.subloopId,
    path: stagePath,
    label: identity.subloopId,
  });
  const preparedFiles = group.files.map((file) => (
    file.path === `${stagePath}/prompts/main.md` ? { ...file, content: legacyPrompt } : file
  ));
  preparedFiles.push(
    { path: `${stagePath}/rules/migrated-v1.md`, content: legacyRules },
    { path: `${stagePath}/schemas/v1-output-schema.json`, content: legacySchema },
  );
  for (const file of preparedFiles) {
    const existing = await dependencies.fs.readText(file.path);
    if (existing !== null && existing !== file.content) {
      throw migrationError("migration_target_exists", `Refusing to overwrite an existing v2 Stage file: ${file.path}`);
    }
  }

  const reportDraft = explicitV1MigrationReportSchema.parse({
    schemaVersion: 1,
    stageId: input.stageId,
    loopId: identity.loopId,
    subloopId: identity.subloopId,
    sourcePath: entry.path,
    backupPath,
    stagePath,
    status: "prepared",
    createdAt: (dependencies.now ?? (() => new Date()))().toISOString(),
  });
  const existingReport = await dependencies.fs.readText(reportPath);
  if (existingReport !== null) {
    try {
      const parsed = explicitV1MigrationReportSchema.parse(JSON.parse(existingReport));
      if (JSON.stringify({ ...parsed, createdAt: "" }) !== JSON.stringify({ ...reportDraft, createdAt: "" })) {
        throw new Error("report mismatch");
      }
    } catch {
      throw migrationError("migration_report_conflict", `Migration report already exists with different content: ${reportPath}`);
    }
  } else {
    await dependencies.fs.writeTextExclusive(reportPath, `${JSON.stringify(reportDraft, null, 2)}\n`);
  }

  if (sourceFiles.length > 0) await dependencies.fs.renameExclusive(entry.path, backupPath);
  for (const directory of group.directories) await dependencies.fs.mkdir(directory);
  const createdFiles: string[] = [];
  for (const file of preparedFiles) {
    if (await dependencies.fs.readText(file.path) !== null) continue;
    await dependencies.fs.writeTextExclusive(file.path, file.content);
    createdFiles.push(file.path);
  }
  return {
    stageId: input.stageId,
    changed: true as const,
    reportPath,
    backupPath,
    stagePath,
    createdFiles,
    requiresInit: true as const,
  };
}

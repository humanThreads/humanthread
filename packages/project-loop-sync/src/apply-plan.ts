import type { LoopSyncPlan, LoopSyncPlanV2, ProjectLoopSyncFilesystem } from "./contracts";

function syncError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export async function applyLoopSyncPlan(input: {
  plan: LoopSyncPlan;
  fs: ProjectLoopSyncFilesystem;
}): Promise<{ createdFiles: number; adoptedFiles: number; recovered: boolean }> {
  await input.fs.mkdir(".humanthread/structure");
  for (const directory of input.plan.createDirectories) await input.fs.mkdir(directory);

  let createdFiles = 0;
  let adoptedFiles = 0;
  for (const file of input.plan.createFiles) {
    const existing = await input.fs.readText(file.path);
    if (existing !== null) {
      if (existing !== file.content) {
        throw syncError("local_rule_conflict", `Refusing to overwrite project-owned file: ${file.path}`);
      }
      adoptedFiles += 1;
      continue;
    }
    await input.fs.writeTextExclusive(file.path, file.content);
    createdFiles += 1;
  }

  await input.fs.writeTextAtomic(".humanthread/structure/lock.json", json(input.plan.lock));
  await input.fs.writeTextAtomic(".humanthread/structure/manifest.json", json(input.plan.manifest));
  return { createdFiles, adoptedFiles, recovered: adoptedFiles > 0 };
}

function hasFiles(paths: string[]): boolean {
  return paths.length > 0;
}

export async function applyLoopSyncPlanV2(input: {
  plan: LoopSyncPlanV2;
  fs: ProjectLoopSyncFilesystem;
}): Promise<{ createdFiles: number; adoptedFiles: number; migratedStages: number; recovered: boolean }> {
  if (input.plan.kind === "blocked") {
    throw syncError("migration_required", "Local v1 rules require explicit migration before ht init can continue");
  }

  await input.fs.mkdir(".humanthread/structure");
  for (const directory of input.plan.createDirectories) await input.fs.mkdir(directory);

  let recovered = false;
  for (const move of input.plan.migrationMoves) {
    const [sourceFiles, backupFiles] = await Promise.all([
      input.fs.listTree(move.from),
      input.fs.listTree(move.to),
    ]);
    if (hasFiles(sourceFiles) && !hasFiles(backupFiles)) {
      await input.fs.renameExclusive(move.from, move.to);
    } else if (!hasFiles(sourceFiles) && hasFiles(backupFiles)) {
      recovered = true;
    } else if (hasFiles(sourceFiles) && hasFiles(backupFiles)) {
      throw syncError("migration_transaction_conflict", `Both migration source and backup exist: ${move.from}`);
    } else {
      throw syncError("migration_source_missing", `Migration source and backup are both missing: ${move.from}`);
    }
  }

  let createdFiles = 0;
  let adoptedFiles = 0;
  for (const file of input.plan.projectOwnedCreates) {
    const existing = await input.fs.readText(file.path);
    if (existing !== null) {
      if (existing !== file.content) {
        throw syncError("local_rule_conflict", `Refusing to overwrite project-owned file: ${file.path}`);
      }
      adoptedFiles += 1;
      recovered = true;
      continue;
    }
    await input.fs.writeTextExclusive(file.path, file.content);
    createdFiles += 1;
  }

  const commitOrder = (path: string): number => path.endsWith("/lock.json") ? 1 : path.endsWith("/manifest.json") ? 2 : 0;
  for (const file of [...input.plan.generatedWrites].sort((left, right) => commitOrder(left.path) - commitOrder(right.path))) {
    await input.fs.writeTextAtomic(file.path, file.content);
  }

  await input.fs.removeTransactionTree(`.humanthread/runtime/sync/${input.plan.transactionId}`);
  return {
    createdFiles,
    adoptedFiles,
    migratedStages: input.plan.migrationMoves.length,
    recovered,
  };
}

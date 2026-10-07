export type GitCommandRunner = (
  command: string,
  args: string[],
  options: { cwd: string },
) => Promise<{ stdout: string; stderr: string }>;

export type IntegrationConflict = {
  paths: string[];
  involvedTaskIds: string[];
  taskDocumentRefs: Array<{ documentId: string; version: number }>;
  knowledgeRefs: string[];
  testReportRefs: string[];
};

type IntegrationTask = {
  taskId: string;
  taskNumber: number;
  branch: string;
  headCommit: string;
  taskDocument: { documentId: string; version: number };
  knowledgeRefs: Array<{ path: string; commit: string }>;
  testReportRef: string;
  requirements?: Array<{ requirementId: string; status: "passed" | "failed" | "inconclusive" | "skipped" }> | undefined;
};

export type MilestoneIntegrationSnapshot = {
  projectId: string;
  milestoneId: string;
  milestoneVersion: number;
  stagingBranch: string;
  tasks: IntegrationTask[];
  stagingBaseCommit: string;
  productionBaseCommit: string;
  taskDependencies?: Array<{ predecessorTaskId: string; successorTaskId: string }>;
};

export type MilestoneIntegrationResult =
  | {
      outcome: "pushed";
      stagingBranch: string;
      candidateCommit: string;
      taskOrder: string[];
      pushReceipt: { status: "succeeded"; remoteHeadCommit: string };
      affectedEvidenceRefs: string[];
      affectedEvidence: Array<{ taskId: string; evidenceRefs: string[]; fingerprint?: string }>;
      fullBusinessEvidenceRefs: string[];
      fullBusinessEvidenceFingerprint?: string;
    }
  | { outcome: "remote_advanced"; stagingBranch: string; remoteHeadCommit: string }
  | { outcome: "conflict"; conflict: IntegrationConflict }
  | { outcome: "tests_failed"; failedTaskId?: string; evidenceRefs: string[] }
  | { outcome: "reconciliation_required"; reason: string; remoteHeadCommit: string | null };

export interface GitIntegrationDependencies {
  run: GitCommandRunner;
  worktreePath: string;
  runAffectedTests(input: { task: IntegrationTask; cwd: string; integrationCommit: string }): Promise<{ passed: boolean; evidenceRefs: string[]; fingerprint?: string }>;
  runFullBusinessTests(input: { cwd: string; integrationCommit: string }): Promise<{ passed: boolean; evidenceRefs: string[]; fingerprint?: string }>;
}

export async function integrateMilestoneBranches(
  snapshot: MilestoneIntegrationSnapshot,
  dependencies: GitIntegrationDependencies,
): Promise<MilestoneIntegrationResult> {
  const tasks = orderTasks(snapshot.tasks, snapshot.taskDependencies ?? []);
  const cwd = dependencies.worktreePath;
  const run = (args: string[]) => dependencies.run("git", args, { cwd: dependencies.worktreePath });
  await run(["fetch", "--prune", "origin"]);
  const initialRemote = await revParse(run, ["--verify", "--end-of-options", `origin/${snapshot.stagingBranch}`]);
  if (initialRemote !== snapshot.stagingBaseCommit) {
    return { outcome: "remote_advanced", stagingBranch: snapshot.stagingBranch, remoteHeadCommit: initialRemote };
  }
  await ensureIntegrationWorktree(run, dependencies.worktreePath, snapshot.stagingBranch);

  const mergedTasks: IntegrationTask[] = [];
  for (const task of tasks) {
    try {
      await run(["merge", "--no-edit", task.headCommit]);
      mergedTasks.push(task);
    } catch (error) {
      if (!isGitConflict(error)) throw error;
      const paths = await unmergedPaths(run);
      return {
        outcome: "conflict",
        conflict: {
          paths,
          involvedTaskIds: [task.taskId],
          taskDocumentRefs: [task.taskDocument],
          knowledgeRefs: task.knowledgeRefs.map((reference) => reference.path),
          testReportRefs: [task.testReportRef],
        },
      };
    }
  }

  const candidateCommit = await revParse(run, ["--verify", "HEAD"]);
  const affectedEvidenceRefs: string[] = [];
  const affectedEvidence: Array<{ taskId: string; evidenceRefs: string[]; fingerprint?: string }> = [];
  for (const task of mergedTasks) {
    const result = await dependencies.runAffectedTests({ task, cwd, integrationCommit: candidateCommit });
    affectedEvidenceRefs.push(...result.evidenceRefs);
    affectedEvidence.push({ taskId: task.taskId, evidenceRefs: result.evidenceRefs, ...(result.fingerprint ? { fingerprint: result.fingerprint } : {}) });
    if (!result.passed) {
      return { outcome: "tests_failed", failedTaskId: task.taskId, evidenceRefs: affectedEvidenceRefs };
    }
  }
  const full = await dependencies.runFullBusinessTests({ cwd, integrationCommit: candidateCommit });
  if (!full.passed) return { outcome: "tests_failed", evidenceRefs: [...affectedEvidenceRefs, ...full.evidenceRefs] };

  const beforePush = await revParse(run, ["--verify", "--end-of-options", `origin/${snapshot.stagingBranch}`]);
  if (beforePush !== snapshot.stagingBaseCommit) {
    return { outcome: "remote_advanced", stagingBranch: snapshot.stagingBranch, remoteHeadCommit: beforePush };
  }
  try {
    await run(["push", "origin", `HEAD:${snapshot.stagingBranch}`]);
  } catch (error) {
    if (isNonFastForward(error)) {
      const remoteHeadCommit = await safeRevParse(run, ["--verify", "--end-of-options", `origin/${snapshot.stagingBranch}`]);
      return { outcome: "remote_advanced", stagingBranch: snapshot.stagingBranch, remoteHeadCommit: remoteHeadCommit ?? "" };
    }
    if (isUnknownPush(error)) {
      const remoteHeadCommit = await safeRevParse(run, ["--verify", "--end-of-options", `origin/${snapshot.stagingBranch}`]);
      return { outcome: "reconciliation_required", reason: "git_push_result_unknown", remoteHeadCommit };
    }
    throw error;
  }
  return {
    outcome: "pushed",
    stagingBranch: snapshot.stagingBranch,
    candidateCommit,
    taskOrder: tasks.map((task) => task.taskId),
    pushReceipt: { status: "succeeded", remoteHeadCommit: candidateCommit },
    affectedEvidenceRefs,
    affectedEvidence,
    fullBusinessEvidenceRefs: full.evidenceRefs,
    ...(full.fingerprint ? { fullBusinessEvidenceFingerprint: full.fingerprint } : {}),
  };
}

async function ensureIntegrationWorktree(
  run: (args: string[]) => Promise<{ stdout: string; stderr: string }>,
  worktreePath: string,
  branch: string,
): Promise<void> {
  try {
    const identity = await run(["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]);
    const lines = identity.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 2 && lines[0] === worktreePath && lines[1] === branch) return;
  } catch {
    // A missing or invalid path is prepared below.
  }
  await run(["worktree", "add", worktreePath, `origin/${branch}`]);
}

function orderTasks(tasks: IntegrationTask[], dependencies: Array<{ predecessorTaskId: string; successorTaskId: string }>): IntegrationTask[] {
  const byId = new Map(tasks.map((task) => [task.taskId, task]));
  const incoming = new Map(tasks.map((task) => [task.taskId, 0]));
  const outgoing = new Map<string, string[]>(tasks.map((task) => [task.taskId, []]));
  for (const dependency of dependencies) {
    if (!byId.has(dependency.predecessorTaskId) || !byId.has(dependency.successorTaskId)) continue;
    outgoing.get(dependency.predecessorTaskId)?.push(dependency.successorTaskId);
    incoming.set(dependency.successorTaskId, (incoming.get(dependency.successorTaskId) ?? 0) + 1);
  }
  const ready = tasks.filter((task) => incoming.get(task.taskId) === 0).sort(taskOrder);
  const ordered: IntegrationTask[] = [];
  while (ready.length > 0) {
    const task = ready.shift();
    if (!task) break;
    ordered.push(task);
    for (const successor of outgoing.get(task.taskId) ?? []) {
      const next = (incoming.get(successor) ?? 1) - 1;
      incoming.set(successor, next);
      if (next === 0) {
        const candidate = byId.get(successor);
        if (candidate) ready.push(candidate);
      }
    }
    ready.sort(taskOrder);
  }
  if (ordered.length !== tasks.length) throw validationError("Task dependency graph contains a cycle");
  return ordered;
}

function taskOrder(left: IntegrationTask, right: IntegrationTask): number {
  return left.taskNumber - right.taskNumber || left.taskId.localeCompare(right.taskId);
}

async function revParse(run: (args: string[]) => Promise<{ stdout: string; stderr: string }>, args: string[]): Promise<string> {
  const output = (await run(["rev-parse", ...args])).stdout.trim();
  if (!/^[a-f0-9]{40}$/u.test(output)) throw validationError("Git ref did not resolve to a commit");
  return output;
}

async function safeRevParse(run: (args: string[]) => Promise<{ stdout: string; stderr: string }>, args: string[]): Promise<string | null> {
  try { return await revParse(run, args); } catch { return null; }
}

async function unmergedPaths(run: (args: string[]) => Promise<{ stdout: string; stderr: string }>): Promise<string[]> {
  const output = (await run(["diff", "--name-only", "--diff-filter=U"])).stdout;
  return [...new Set(output.split("\n").map((path) => path.trim()).filter(Boolean))].sort();
}

function isGitConflict(error: unknown): boolean {
  return error instanceof Error && ("code" in error ? String(error.code) === "git_conflict" : /conflict/iu.test(error.message));
}

function isNonFastForward(error: unknown): boolean {
  return error instanceof Error && ("code" in error ? String(error.code) === "non_fast_forward" : /non-fast-forward|rejected/iu.test(error.message));
}

function isUnknownPush(error: unknown): boolean {
  return error instanceof Error && ("code" in error ? String(error.code) === "push_unknown" : /timeout|network|unknown/iu.test(error.message));
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

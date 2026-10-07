import { execFileSync } from "node:child_process";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

/**
 * Published Desktop bytes must come from the synchronized main branch.
 * Candidate builds can still be produced elsewhere for verification.
 */
export function assertReleaseSource({ execGit = runGit } = {}) {
  const branch = execGit(["branch", "--show-current"]).trim();
  if (branch !== "main") {
    throw new Error("Releases must be packaged and published from main");
  }

  const gitDir = execGit(["rev-parse", "--path-format=absolute", "--git-dir"]).trim();
  const gitCommonDir = execGit(["rev-parse", "--path-format=absolute", "--git-common-dir"]).trim();
  if (!gitDir || !gitCommonDir || gitDir !== gitCommonDir) {
    throw new Error("Releases require the primary main checkout, not a worktree");
  }

  const status = execGit(["status", "--porcelain=v1", "--untracked-files=all"]).trim();
  if (status) {
    throw new Error("Releases require a clean main worktree");
  }

  const head = execGit(["rev-parse", "--verify", "HEAD"]).trim();
  const originMain = execGit(["rev-parse", "--verify", "origin/main"]).trim();
  if (!head || !originMain || head !== originMain) {
    throw new Error("Releases require HEAD to match origin/main");
  }
}

export const assertDesktopReleaseSource = assertReleaseSource;

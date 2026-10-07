import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appDirectory = fileURLToPath(new URL(".", import.meta.url));

function findRouteLoadingFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return findRouteLoadingFiles(path);
    return entry.isFile() && entry.name === "loading.tsx" ? [path] : [];
  });
}

describe("workbench route loading policy", () => {
  it("does not render stale route-level loading pages during navigation", () => {
    expect(findRouteLoadingFiles(appDirectory)).toEqual([]);
  });

  it("does not retain the legacy workbench loading shell", () => {
    expect(existsSync(join(appDirectory, "components/workbench-loading.tsx"))).toBe(false);
  });
});

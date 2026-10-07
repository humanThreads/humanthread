import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageManifest {
  name: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const repoRoot = new URL("../../../../../", import.meta.url);

function readManifest(path: string): PackageManifest {
  return JSON.parse(readFileSync(new URL(path, repoRoot), "utf8")) as PackageManifest;
}

function workspaceDependencyNames(manifest: PackageManifest): string[] {
  return [
    manifest.dependencies,
    manifest.devDependencies,
    manifest.optionalDependencies,
    manifest.peerDependencies,
  ].flatMap((dependencies) =>
    Object.entries(dependencies ?? {})
      .filter(([, version]) => version.startsWith("workspace:"))
      .map(([name]) => name),
  );
}

function requiredWorkspaceManifestPaths(): string[] {
  const manifestByName = new Map<string, { manifest: PackageManifest; path: string }>();
  for (const entry of readdirSync(new URL("packages/", repoRoot), {
    withFileTypes: true,
  })) {
    if (!entry.isDirectory()) continue;
    const path = `packages/${entry.name}/package.json`;
    const manifest = readManifest(path);
    manifestByName.set(manifest.name, { manifest, path });
  }

  const requiredPaths = new Set<string>();
  const pendingNames = workspaceDependencyNames(readManifest("apps/web/package.json"));
  while (pendingNames.length > 0) {
    const name = pendingNames.pop();
    if (!name) continue;
    const workspacePackage = manifestByName.get(name);
    if (!workspacePackage || requiredPaths.has(workspacePackage.path)) continue;
    requiredPaths.add(workspacePackage.path);
    pendingNames.push(...workspaceDependencyNames(workspacePackage.manifest));
  }

  return [...requiredPaths].sort();
}

describe("Web Docker dependency stage", () => {
  it("copies the complete Web workspace dependency closure before install", () => {
    const dockerfile = readFileSync(new URL("Dockerfile", repoRoot), "utf8");
    const depsStageStart = dockerfile.indexOf("FROM base AS deps");
    const depsStageEnd = dockerfile.indexOf("FROM deps AS builder");
    expect(depsStageStart).toBeGreaterThanOrEqual(0);
    expect(depsStageEnd).toBeGreaterThan(depsStageStart);

    const depsStage = dockerfile.slice(depsStageStart, depsStageEnd);
    const dependencyBuild = dockerfile.slice(0, depsStageEnd);
    expect(dependencyBuild).toContain(
      "ARG NPM_REGISTRY=https://registry.npmjs.org/",
    );
    expect(dependencyBuild).toContain("ENV NPM_CONFIG_REGISTRY=$NPM_REGISTRY");
    expect(dependencyBuild).toContain("ENV COREPACK_NPM_REGISTRY=$NPM_REGISTRY");
    expect(dependencyBuild).toMatch(
      /for attempt in 1 2 3; do[\s\S]*corepack prepare pnpm@10\.33\.2 --activate[\s\S]*done/u,
    );
    const install = 'RUN pnpm install --frozen-lockfile --registry="$NPM_REGISTRY"';
    const installIndex = depsStage.indexOf(install);
    expect(installIndex).toBeGreaterThanOrEqual(0);

    for (const manifestPath of requiredWorkspaceManifestPaths()) {
      const manifestCopy = `COPY ${manifestPath} ${manifestPath}`;
      expect(depsStage).toContain(manifestCopy);
      expect(depsStage.indexOf(manifestCopy)).toBeLessThan(installIndex);
    }
  });

  it("uses the Prisma Client generated in the builder stage at runtime", () => {
    const dockerfile = readFileSync(new URL("Dockerfile", repoRoot), "utf8");
    const runnerStageStart = dockerfile.indexOf("FROM base AS runner");
    expect(runnerStageStart).toBeGreaterThanOrEqual(0);
    const runnerStage = dockerfile.slice(runnerStageStart);

    expect(runnerStage).toContain("COPY --from=builder --chown=nextjs:nodejs /app/node_modules ./node_modules");
    expect(runnerStage).not.toContain("COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules");
    expect(runnerStage).toContain("COPY --from=builder --chown=nextjs:nodejs /app/packages/db/node_modules ./packages/db/node_modules");
    expect(runnerStage).not.toContain("COPY --from=deps --chown=nextjs:nodejs /app/packages/db/node_modules ./packages/db/node_modules");
  });
});

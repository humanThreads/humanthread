import { z } from "zod";

const semverSchema = z.string().regex(
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u,
  "Invalid release version",
);

export const RELEASE_ARTIFACTS = {
  "desktop.macos.arm64": {
    id: "desktop.macos.arm64",
    product: "desktop",
    platform: "macos",
    arch: "arm64",
    extension: ".dmg",
    downloadPath: "desktop/macos/arm64",
    objectPrefix: "downloads/desktop/macos/arm64",
    objectFileName: "HumanThread.dmg",
    legacyExtensions: [".zip"],
  },
  "desktop.macos.x64": {
    id: "desktop.macos.x64",
    product: "desktop",
    platform: "macos",
    arch: "x64",
    extension: ".dmg",
    downloadPath: "desktop/macos/x64",
    objectPrefix: "downloads/desktop/macos/x64",
    objectFileName: "HumanThread.dmg",
    legacyExtensions: [".zip"],
  },
  "desktop.windows.x64": {
    id: "desktop.windows.x64",
    product: "desktop",
    platform: "windows",
    arch: "x64",
    extension: ".msi",
    downloadPath: "desktop/windows/x64",
    objectPrefix: "downloads/desktop/windows/x64",
    objectFileName: "HumanThread.msi",
  },
  "desktop.linux.x64": {
    id: "desktop.linux.x64",
    product: "desktop",
    platform: "linux",
    arch: "x64",
    extension: ".AppImage",
    downloadPath: "desktop/linux/x64",
    objectPrefix: "downloads/desktop/linux/x64",
    objectFileName: "HumanThread.AppImage",
  },
  "mobile.android.universal": {
    id: "mobile.android.universal",
    product: "mobile",
    platform: "android",
    arch: "universal",
    extension: ".apk",
    downloadPath: "mobile/android",
    objectPrefix: "downloads/mobile/android/universal",
    objectFileName: "HumanThread.apk",
  },
  "cli.node": {
    id: "cli.node",
    product: "cli",
    platform: "node",
    arch: "any",
    extension: ".tgz",
    downloadPath: "cli",
    objectPrefix: "downloads/cli",
    objectFileName: "humanthread-cli.tgz",
  },
} as const;

export type ReleaseArtifactId = keyof typeof RELEASE_ARTIFACTS;
export type ReleaseArtifactDefinition = (typeof RELEASE_ARTIFACTS)[ReleaseArtifactId];

export interface ReleaseArtifactLookup {
  product: string;
  platform: string;
  arch: string;
}

export function resolveReleaseArtifact(
  lookup: ReleaseArtifactLookup,
): ReleaseArtifactDefinition | null {
  return Object.values(RELEASE_ARTIFACTS).find((artifact) =>
    artifact.product === lookup.product
      && artifact.platform === lookup.platform
      && artifact.arch === lookup.arch,
  ) ?? null;
}

export function resolveReleaseArtifactByDownloadPath(
  downloadPath: string,
): ReleaseArtifactDefinition | null {
  return Object.values(RELEASE_ARTIFACTS).find(
    (artifact) => artifact.downloadPath === downloadPath,
  ) ?? null;
}

export function buildReleaseObjectKey(
  artifactId: ReleaseArtifactId,
  version: string,
): string {
  const parsedVersion = semverSchema.parse(version);
  const artifact = RELEASE_ARTIFACTS[artifactId];
  return `${artifact.objectPrefix}/${parsedVersion}/${artifact.objectFileName}`;
}

function withExtension(fileName: string, extension: string): string {
  return `${fileName.slice(0, fileName.lastIndexOf("."))}${extension}`;
}

function legacyReleaseEntries(
  artifactId: ReleaseArtifactId,
  version: string,
): Array<{ objectKey: string; fileName: string }> {
  const artifact = RELEASE_ARTIFACTS[artifactId];
  const legacyExtensions = "legacyExtensions" in artifact ? artifact.legacyExtensions : undefined;
  if (!legacyExtensions) return [];
  return legacyExtensions.map((extension) => ({
    objectKey: `${artifact.objectPrefix}/${version}/${withExtension(artifact.objectFileName, extension)}`,
    fileName: buildReleaseFileNameWithExtension(artifactId, version, extension),
  }));
}

export function buildReleaseFileName(
  artifactId: ReleaseArtifactId,
  version: string,
): string {
  return buildReleaseFileNameWithExtension(artifactId, version, RELEASE_ARTIFACTS[artifactId].extension);
}

function buildReleaseFileNameWithExtension(
  artifactId: ReleaseArtifactId,
  version: string,
  extension: string,
): string {
  const parsedVersion = semverSchema.parse(version);
  const artifact = RELEASE_ARTIFACTS[artifactId];
  if (artifact.id === "cli.node") return `humanthread-cli-${parsedVersion}.tgz`;
  const suffix = artifact.product === "mobile"
    ? artifact.platform
    : `${artifact.platform}-${artifact.arch}`;
  return `HumanThread-${parsedVersion}-${suffix}${extension}`;
}

const releaseEntrySchema = z.object({
  version: semverSchema,
  objectKey: z.string().min(1).max(512),
  fileName: z.string().min(1).max(191),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  publishedAt: z.iso.datetime(),
}).strict();

const artifactIds = Object.keys(RELEASE_ARTIFACTS) as [
  ReleaseArtifactId,
  ...ReleaseArtifactId[],
];

export const releaseManifestSchema = z.object({
  schemaVersion: z.literal(1),
  publishedAt: z.iso.datetime(),
  artifacts: z.partialRecord(z.enum(artifactIds), releaseEntrySchema),
}).strict();

export type ReleaseManifest = z.infer<typeof releaseManifestSchema>;
export type ReleaseManifestEntry = NonNullable<
  ReleaseManifest["artifacts"][ReleaseArtifactId]
>;

export function parseReleaseManifest(input: unknown): ReleaseManifest {
  const manifest = releaseManifestSchema.parse(input);
  for (const [artifactId, entry] of Object.entries(manifest.artifacts)) {
    const typedArtifactId = artifactId as ReleaseArtifactId;
    const accepted = [
      {
        objectKey: buildReleaseObjectKey(typedArtifactId, entry.version),
        fileName: buildReleaseFileName(typedArtifactId, entry.version),
      },
      ...legacyReleaseEntries(typedArtifactId, entry.version),
    ];
    if (!accepted.some((candidate) => candidate.objectKey === entry.objectKey)) {
      throw new Error(`Release object key does not match ${artifactId}`);
    }
    if (!accepted.some((candidate) => candidate.fileName === entry.fileName)) {
      throw new Error(`Release file name does not match ${artifactId}`);
    }
  }
  return manifest;
}

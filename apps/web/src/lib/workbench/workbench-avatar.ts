import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { prisma } from "../../../../../packages/db/src/index";
import { resolveSourceRepositoryUrl } from "./workbench-source-repository";
import type { WorkbenchSession } from "./workbench-session";

export const WORKBENCH_AVATAR_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const WORKBENCH_AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const WORKBENCH_AVATAR_EXTENSION_BY_MIME: Record<
  (typeof WORKBENCH_AVATAR_ALLOWED_MIME_TYPES)[number],
  "png" | "jpg" | "webp" | "gif"
> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const WORKBENCH_AVATAR_SUPPORTED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
] as const;

interface WorkbenchAvatarUploadDb {
  user: {
    update(args: {
      where: {
        id: string;
      };
      data: {
        avatarUrl: string;
        avatarUpdatedAt: Date;
      };
    }): Promise<unknown>;
  };
}

export function buildWorkbenchAvatarSrc(
  avatarUrl: string | null | undefined,
  avatarUpdatedAt: Date | null | undefined,
): string | null {
  if (!avatarUrl) {
    return null;
  }

  if (!avatarUpdatedAt) {
    return avatarUrl;
  }

  const separator = avatarUrl.includes("?") ? "&" : "?";

  return `${avatarUrl}${separator}v=${avatarUpdatedAt.getTime()}`;
}

export function getWorkbenchShellLoginProps(
  session: Pick<WorkbenchSession, "loginEmail" | "account">,
) {
  return {
    loginName: session.account?.name ?? null,
    loginAvatarSrc: buildWorkbenchAvatarSrc(
      session.account?.avatarUrl ?? null,
      session.account?.avatarUpdatedAt ?? null,
    ),
    sourceRepositoryUrl: resolveSourceRepositoryUrl(
      process.env.HUMANTHREAD_SOURCE_REPOSITORY,
    ),
  };
}

export function resolveWorkbenchAvatarPublicRoot(cwd = process.cwd()): string {
  const normalized = resolve(cwd);

  if (
    basename(normalized) === "web" &&
    basename(dirname(normalized)) === "apps"
  ) {
    return join(normalized, "public");
  }

  return join(normalized, "apps", "web", "public");
}

export function resolveWorkbenchAvatarExtension(input: {
  mimeType: string | null | undefined;
  fileName: string | null | undefined;
}): "png" | "jpg" | "webp" | "gif" | null {
  const normalizedMimeType = input.mimeType?.trim().toLowerCase();

  if (
    normalizedMimeType &&
    normalizedMimeType in WORKBENCH_AVATAR_EXTENSION_BY_MIME
  ) {
    return WORKBENCH_AVATAR_EXTENSION_BY_MIME[
      normalizedMimeType as keyof typeof WORKBENCH_AVATAR_EXTENSION_BY_MIME
    ];
  }

  const normalizedExtension = extname(input.fileName?.trim() ?? "")
    .replace(/^\./u, "")
    .toLowerCase();

  if (normalizedExtension === "jpeg") {
    return "jpg";
  }

  return WORKBENCH_AVATAR_SUPPORTED_EXTENSIONS.includes(
    normalizedExtension as (typeof WORKBENCH_AVATAR_SUPPORTED_EXTENSIONS)[number],
  )
    ? (normalizedExtension as "png" | "jpg" | "webp" | "gif")
    : null;
}

export async function saveWorkbenchAvatarUpload(input: {
  userId: string;
  file: File;
  cwd?: string;
  now?: Date;
  db?: WorkbenchAvatarUploadDb;
}) {
  if (!input.file || input.file.size === 0) {
    throw new Error("Avatar file is required");
  }

  if (input.file.size > WORKBENCH_AVATAR_MAX_BYTES) {
    throw new Error("Avatar file is too large");
  }

  const extension = resolveWorkbenchAvatarExtension({
    mimeType: input.file.type,
    fileName: input.file.name,
  });

  if (!extension) {
    throw new Error("Unsupported avatar file type");
  }

  const avatarDirectoryName = encodeURIComponent(input.userId);
  const publicRoot = resolveWorkbenchAvatarPublicRoot(input.cwd);
  const avatarDirectory = join(
    publicRoot,
    "uploads",
    "avatars",
    avatarDirectoryName,
  );
  const avatarFileName = `avatar.${extension}`;
  const avatarPath = join(avatarDirectory, avatarFileName);
  const avatarUrl = `/uploads/avatars/${avatarDirectoryName}/${avatarFileName}`;
  const avatarUpdatedAt = input.now ?? new Date();
  const db = (input.db ?? prisma) as WorkbenchAvatarUploadDb;

  await mkdir(avatarDirectory, { recursive: true });
  await Promise.all(
    WORKBENCH_AVATAR_SUPPORTED_EXTENSIONS.map((candidate) =>
      rm(join(avatarDirectory, `avatar.${candidate}`), { force: true }),
    ),
  );
  await writeFile(avatarPath, Buffer.from(await input.file.arrayBuffer()));

  await db.user.update({
    where: {
      id: input.userId,
    },
    data: {
      avatarUrl,
      avatarUpdatedAt,
    },
  });

  return {
    avatarUrl,
    avatarUpdatedAt,
  };
}

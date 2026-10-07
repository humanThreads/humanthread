import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { prisma } from "../../../../../packages/db/src/index";

export const WORKBENCH_COMPANY_LOGO_ALLOWED_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;

export const WORKBENCH_COMPANY_LOGO_MAX_BYTES = 2 * 1024 * 1024;

const COMPANY_LOGO_EXTENSION_BY_MIME: Record<
  (typeof WORKBENCH_COMPANY_LOGO_ALLOWED_MIME_TYPES)[number],
  "png" | "jpg" | "webp" | "gif"
> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

const COMPANY_LOGO_SUPPORTED_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
] as const;

interface WorkbenchCompanyLogoUploadDb {
  company: {
    update(args: {
      where: {
        id: string;
      };
      data: {
        logoUrl: string;
      };
    }): Promise<unknown>;
  };
  companyMember: {
    findFirst(args: unknown): Promise<{ role: string } | null>;
  };
}

function resolveCompanyLogoPublicRoot(cwd = process.cwd()): string {
  const normalized = resolve(cwd);

  if (
    basename(normalized) === "web" &&
    basename(dirname(normalized)) === "apps"
  ) {
    return join(normalized, "public");
  }

  return join(normalized, "apps", "web", "public");
}

function resolveCompanyLogoExtension(input: {
  mimeType: string | null | undefined;
  fileName: string | null | undefined;
}): "png" | "jpg" | "webp" | "gif" | null {
  const normalizedMimeType = input.mimeType?.trim().toLowerCase();

  if (
    normalizedMimeType &&
    normalizedMimeType in COMPANY_LOGO_EXTENSION_BY_MIME
  ) {
    return COMPANY_LOGO_EXTENSION_BY_MIME[
      normalizedMimeType as keyof typeof COMPANY_LOGO_EXTENSION_BY_MIME
    ];
  }

  const normalizedExtension = extname(input.fileName?.trim() ?? "")
    .replace(/^\./u, "")
    .toLowerCase();

  if (normalizedExtension === "jpeg") {
    return "jpg";
  }

  return COMPANY_LOGO_SUPPORTED_EXTENSIONS.includes(
    normalizedExtension as (typeof COMPANY_LOGO_SUPPORTED_EXTENSIONS)[number],
  )
    ? (normalizedExtension as "png" | "jpg" | "webp" | "gif")
    : null;
}

export async function saveWorkbenchCompanyLogoUpload(input: {
  userId: string;
  companyId: string;
  file: File;
  cwd?: string;
  db?: WorkbenchCompanyLogoUploadDb;
}) {
  if (!input.file || input.file.size === 0) {
    throw new Error("Logo file is required");
  }

  if (input.file.size > WORKBENCH_COMPANY_LOGO_MAX_BYTES) {
    throw new Error("Logo file is too large");
  }

  const extension = resolveCompanyLogoExtension({
    mimeType: input.file.type,
    fileName: input.file.name,
  });

  if (!extension) {
    throw new Error("Unsupported logo file type");
  }

  const logoDirectoryName = encodeURIComponent(input.companyId);
  const publicRoot = resolveCompanyLogoPublicRoot(input.cwd);
  const logoDirectory = join(publicRoot, "uploads", "company-logo", logoDirectoryName);
  const logoFileName = `logo.${extension}`;
  const logoPath = join(logoDirectory, logoFileName);
  const logoUrl = `/uploads/company-logo/${logoDirectoryName}/${logoFileName}`;
  const db = (input.db ?? prisma) as WorkbenchCompanyLogoUploadDb;

  const membership = await db.companyMember.findFirst({
    where: {
      companyId: input.companyId,
      userId: input.userId,
      status: "active",
      role: {
        in: ["owner", "admin"],
      },
    },
    select: {
      role: true,
    },
  });

  if (!membership) {
    throw new Error("Company management permission is required");
  }

  await mkdir(logoDirectory, { recursive: true });
  await Promise.all(
    COMPANY_LOGO_SUPPORTED_EXTENSIONS.map((candidate) =>
      rm(join(logoDirectory, `logo.${candidate}`), { force: true }),
    ),
  );
  await writeFile(logoPath, Buffer.from(await input.file.arrayBuffer()));

  await db.company.update({
    where: {
      id: input.companyId,
    },
    data: {
      logoUrl,
    },
  });

  return {
    logoUrl,
  };
}

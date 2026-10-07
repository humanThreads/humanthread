import { prisma } from "../../../../../packages/db/src/index";
import { getUserTaskRollout, type UserTaskRollout } from "../tasks/task-rollout";

export const DEFAULT_WORKBENCH_SITE_BASE_URL = "http://localhost:3000";
export const WORKBENCH_SITE_BASE_URL_SETTING_KEY = "siteBaseUrl";

export interface WorkbenchSiteSettings {
  siteBaseUrl: string;
  mcpUrl: string;
  userTasks: UserTaskRollout;
}

interface WorkbenchSiteSettingsDb {
  siteSetting: {
    findUnique(args: {
      where: {
        key: string;
      };
      select: {
        value: true;
      };
    }): Promise<{ value: string } | null>;
  };
}

interface WorkbenchUpdateSiteSettingsDb {
  user: {
    findUnique(args: {
      where: {
        id: string;
      };
      select: {
        isSiteAdmin: true;
      };
    }): Promise<{ isSiteAdmin: boolean } | null>;
  };
  siteSetting: {
    upsert(args: {
      where: {
        key: string;
      };
      create: {
        key: string;
        value: string;
      };
      update: {
        value: string;
      };
    }): Promise<unknown>;
  };
}

type WorkbenchSiteSettingsEnv = Record<string, string | undefined>;

function getDefaultSiteBaseUrl(
  env: WorkbenchSiteSettingsEnv = process.env,
): string {
  const envValue = env.HUMANTHREAD_SITE_BASE_URL?.trim();

  return envValue
    ? normalizeWorkbenchSiteBaseUrl(envValue)
    : DEFAULT_WORKBENCH_SITE_BASE_URL;
}

export function normalizeWorkbenchSiteBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/u, "");

  if (!trimmed) {
    throw new Error("Site domain is required");
  }

  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Site domain must be a valid URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Site domain must start with http:// or https://");
  }

  url.pathname = "";
  url.search = "";
  url.hash = "";

  return url.toString().replace(/\/+$/u, "");
}

export async function getWorkbenchSiteSettings(input: {
  db?: WorkbenchSiteSettingsDb;
  env?: WorkbenchSiteSettingsEnv;
} = {}): Promise<WorkbenchSiteSettings> {
  const fallback = getDefaultSiteBaseUrl(input.env);
  const db = (input.db ?? prisma) as WorkbenchSiteSettingsDb;
  const record = await db.siteSetting.findUnique({
    where: {
      key: WORKBENCH_SITE_BASE_URL_SETTING_KEY,
    },
    select: {
      value: true,
    },
  });
  const siteBaseUrl = record?.value
    ? normalizeWorkbenchSiteBaseUrl(record.value)
    : fallback;

  return {
    siteBaseUrl,
    mcpUrl: `${siteBaseUrl}/api/mcp`,
    userTasks: getUserTaskRollout(input.env),
  };
}

export async function isWorkbenchSiteAdmin(input: {
  userId: string;
  db?: Pick<WorkbenchUpdateSiteSettingsDb, "user">;
}): Promise<boolean> {
  const db = input.db ?? prisma;
  const user = await db.user.findUnique({
    where: {
      id: input.userId,
    },
    select: {
      isSiteAdmin: true,
    },
  });

  return user?.isSiteAdmin === true;
}

export async function updateWorkbenchSiteSettings(input: {
  userId: string;
  siteBaseUrl: string;
  db?: WorkbenchUpdateSiteSettingsDb;
}): Promise<WorkbenchSiteSettings> {
  const db = (input.db ?? prisma) as WorkbenchUpdateSiteSettingsDb;
  const admin = await isWorkbenchSiteAdmin({
    userId: input.userId,
    db,
  });

  if (!admin) {
    throw new Error("Site administrator permission is required");
  }

  const siteBaseUrl = normalizeWorkbenchSiteBaseUrl(input.siteBaseUrl);

  await db.siteSetting.upsert({
    where: {
      key: WORKBENCH_SITE_BASE_URL_SETTING_KEY,
    },
    create: {
      key: WORKBENCH_SITE_BASE_URL_SETTING_KEY,
      value: siteBaseUrl,
    },
    update: {
      value: siteBaseUrl,
    },
  });

  return {
    siteBaseUrl,
    mcpUrl: `${siteBaseUrl}/api/mcp`,
    userTasks: getUserTaskRollout(),
  };
}

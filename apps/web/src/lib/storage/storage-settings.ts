import { prisma } from "../../../../../packages/db/src/index";
import { parseStorageConfig, type StorageConfig } from "./unified-storage";

export const STORAGE_CONFIG_SETTING_KEY = "storageConfig";
type SettingsDb = { siteSetting: { findUnique(args: unknown): Promise<{ value: string } | null>; upsert?(args: unknown): Promise<unknown> }; user?: { findUnique(args: unknown): Promise<{ isSiteAdmin: boolean } | null> } };

export async function getStorageSettings(input: { db?: { siteSetting: Pick<SettingsDb["siteSetting"], "findUnique"> } } = {}): Promise<StorageConfig | null> {
  const db = input.db ?? prisma;
  const row = await db.siteSetting.findUnique({ where: { key: STORAGE_CONFIG_SETTING_KEY }, select: { value: true } });
  if (!row?.value) return null;
  return parseStorageConfig(JSON.parse(row.value));
}

export async function updateStorageSettings(input: { userId: string; config: unknown; db?: SettingsDb }): Promise<StorageConfig> {
  const db = input.db ?? prisma;
  const user = await db.user?.findUnique({ where: { id: input.userId }, select: { isSiteAdmin: true } });
  if (!user?.isSiteAdmin) throw new Error("Site administrator permission is required");
  const config = parseStorageConfig(input.config);
  if (!db.siteSetting.upsert) throw new Error("Storage settings persistence is unavailable");
  await db.siteSetting.upsert({ where: { key: STORAGE_CONFIG_SETTING_KEY }, create: { key: STORAGE_CONFIG_SETTING_KEY, value: JSON.stringify(config) }, update: { value: JSON.stringify(config) } });
  return config;
}

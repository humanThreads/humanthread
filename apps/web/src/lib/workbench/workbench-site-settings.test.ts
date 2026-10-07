import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_WORKBENCH_SITE_BASE_URL,
  getWorkbenchSiteSettings,
  normalizeWorkbenchSiteBaseUrl,
  updateWorkbenchSiteSettings,
} from "./workbench-site-settings";

describe("workbench site settings", () => {
  it("normalizes a public site base URL", () => {
    expect(normalizeWorkbenchSiteBaseUrl(" http://localhost:3000/ ")).toBe(
      "http://localhost:3000",
    );
    expect(normalizeWorkbenchSiteBaseUrl("http://humanthread.local:50888/")).toBe(
      "http://humanthread.local:50888",
    );
  });

  it("rejects unsafe site base URLs", () => {
    expect(() => normalizeWorkbenchSiteBaseUrl("")).toThrow(
      "Site domain is required",
    );
    expect(() => normalizeWorkbenchSiteBaseUrl("ftp://humanthread.example.com")).toThrow(
      "Site domain must start with http:// or https://",
    );
  });

  it("falls back to the product domain when no database setting exists", async () => {
    const findUnique = vi.fn().mockResolvedValue(null);

    const settings = await getWorkbenchSiteSettings({
      db: {
        siteSetting: {
          findUnique,
        },
      },
      env: {},
    });

    expect(settings.siteBaseUrl).toBe(DEFAULT_WORKBENCH_SITE_BASE_URL);
    expect(settings.mcpUrl).toBe(`${DEFAULT_WORKBENCH_SITE_BASE_URL}/api/mcp`);
    expect(settings.userTasks).toEqual({ reads: false, writes: false });
  });

  it("updates the site domain only for site administrators", async () => {
    const userFindUnique = vi.fn().mockResolvedValue({ isSiteAdmin: true });
    const siteSettingUpsert = vi.fn().mockResolvedValue({
      key: "siteBaseUrl",
      value: "https://console.example.com",
    });

    await updateWorkbenchSiteSettings({
      userId: "user_admin",
      siteBaseUrl: " https://console.example.com/ ",
      db: {
        user: {
          findUnique: userFindUnique,
        },
        siteSetting: {
          upsert: siteSettingUpsert,
        },
      },
    });

    expect(siteSettingUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "siteBaseUrl" },
        create: expect.objectContaining({
          key: "siteBaseUrl",
          value: "https://console.example.com",
        }),
        update: {
          value: "https://console.example.com",
        },
      }),
    );
  });
});

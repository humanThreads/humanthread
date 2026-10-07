import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireWorkbenchSession } from "./workbench-route-auth";

const cookieGet = vi.hoisted(() => vi.fn());
const redirect = vi.hoisted(() => vi.fn((href: string) => {
  throw new Error(`redirect:${href}`);
}));
const resolveWorkbenchSession = vi.hoisted(() => vi.fn());

vi.mock("next/headers", () => ({ cookies: vi.fn().mockResolvedValue({ get: cookieGet }) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("./workbench-session", () => ({
  hasWorkbenchAuthenticationCookie: (getCookieValue: (name: string) => string | undefined) => Boolean(
    getCookieValue("ht_web_session"),
  ),
  resolveWorkbenchSession,
}));
vi.mock("./workbench-settings", () => ({ getWorkbenchAccountSettings: vi.fn() }));

describe("requireWorkbenchSession", () => {
  beforeEach(() => {
    cookieGet.mockReset();
    redirect.mockClear();
    resolveWorkbenchSession.mockReset();
  });

  it("redirects anonymous routes before resolving database-backed context", async () => {
    cookieGet.mockReturnValue(undefined);

    await expect(requireWorkbenchSession("/reports")).rejects.toThrow(
      "redirect:/login?redirectTo=%2Freports",
    );
    expect(resolveWorkbenchSession).not.toHaveBeenCalled();
  });

  it.each(["ht_workbench_session", "ht_workbench_login_email", "ht_workbench_user_id"])(
    "redirects requests that only carry legacy cookie %s",
    async (legacyCookie) => {
      cookieGet.mockImplementation((name: string) => name === legacyCookie ? { value: "legacy" } : undefined);
      await expect(requireWorkbenchSession("/reports")).rejects.toThrow(
        "redirect:/login?redirectTo=%2Freports",
      );
      expect(resolveWorkbenchSession).not.toHaveBeenCalled();
    },
  );
});

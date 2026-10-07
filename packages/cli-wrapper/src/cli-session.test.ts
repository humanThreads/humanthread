import { mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { loadCliSession, saveCliSession } from "./cli-session";

describe("CLI session storage", () => {
  it("writes a private session file outside the project workspace", async () => {
    const directory = await mkdtemp(join(tmpdir(), "humanthread-cli-test-"));
    const path = join(directory, "config", "cli-session.json");
    const session = {
      baseUrl: "http://localhost:3000",
      installationId: "ht-cli-installation",
      deviceId: "cli_device_1",
      sessionId: "desktop_session_1",
      accessToken: "v1.access.signature",
      accessExpiresAt: "2026-08-26T08:00:00.000Z",
      refreshToken: "ht_desktop_refresh_1",
    };

    await saveCliSession(session, path);

    expect(await loadCliSession(path)).toEqual(session);
    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });
});

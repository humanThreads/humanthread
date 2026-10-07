import { afterAll, describe, expect, it } from "vitest";
import { createPrismaClient } from "../packages/db/src/prisma";
import { derivedPersistenceId } from "../packages/db/src/bounded-id";
import { createPasswordHash } from "../apps/web/src/lib/workbench/workbench-auth";
import { resolveWorkbenchApiActor } from "../apps/web/src/lib/workbench/workbench-api-session";
import {
  createWebSession,
  resolveActiveWebSession,
  revokeWebSession,
} from "../apps/web/src/lib/workbench/web-session-store";
import { changeWorkbenchPassword } from "../apps/web/src/lib/workbench/workbench-settings";

const testDatabaseUrl = process.env.HUMANTHREAD_TEST_DATABASE_URL?.trim();
const fixtureKey = "web-session-integration-v1";
const ids = {
  team: derivedPersistenceId([fixtureKey, "team"]),
  user: derivedPersistenceId([fixtureKey, "user"]),
};
const tokens = {
  a: "web-session-integration-token-a",
  b: "web-session-integration-token-b",
  c: "web-session-integration-token-c",
};
const oldPassword = "integration-old-password";
const newPassword = "integration-new-password";
const now = new Date("2026-08-12T08:00:00.000Z");
const request = new Request("http://localhost:3000/login", {
  headers: {
    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/140.0",
    "x-forwarded-for": "192.0.2.10",
  },
});

let client;

async function cleanFixture() {
  if (!client) return;
  await client.webSession.deleteMany({ where: { userId: ids.user } });
  await client.user.deleteMany({ where: { id: ids.user } });
  await client.team.deleteMany({ where: { id: ids.team } });
}

afterAll(async () => {
  if (!client) return;
  await cleanFixture();
  await client.$disconnect();
});

describe.skipIf(!testDatabaseUrl)("Web session MariaDB integration", () => {
  it("revokes one device, preserves the current device after password change, and rejects legacy cookies", async () => {
    client = createPrismaClient(testDatabaseUrl);
    await client.$connect();
    await cleanFixture();

    try {
      await client.team.create({
        data: { id: ids.team, name: "Web session integration team" },
      });
      await client.user.create({
        data: {
          id: ids.user,
          teamId: ids.team,
          name: "Web session integration user",
          email: `${ids.user}@integration.invalid`,
          status: "active",
          passwordHash: createPasswordHash(oldPassword, {
            salt: "web-session-integration-salt",
            iterations: 1_000,
          }),
        },
      });

      const sessionA = await createWebSession({
        userId: ids.user,
        request,
        now,
        generateToken: () => tokens.a,
        db: client,
      });
      const sessionB = await createWebSession({
        userId: ids.user,
        request,
        now,
        generateToken: () => tokens.b,
        db: client,
      });

      await expect(resolveActiveWebSession({ token: tokens.a, now, db: client }))
        .resolves.toMatchObject({ userId: ids.user, webSessionId: sessionA.session.id });
      await expect(resolveActiveWebSession({ token: tokens.b, now, db: client }))
        .resolves.toMatchObject({ userId: ids.user, webSessionId: sessionB.session.id });

      await revokeWebSession({
        userId: ids.user,
        targetSessionId: sessionB.session.id,
        reason: "remote_logout",
        now,
        db: client,
      });

      await expect(resolveActiveWebSession({ token: tokens.a, now, db: client }))
        .resolves.toMatchObject({ webSessionId: sessionA.session.id });
      await expect(resolveActiveWebSession({ token: tokens.b, now, db: client }))
        .resolves.toBeNull();

      const sessionC = await createWebSession({
        userId: ids.user,
        request,
        now,
        generateToken: () => tokens.c,
        db: client,
      });
      await expect(changeWorkbenchPassword({
        userId: ids.user,
        currentSessionId: sessionA.session.id,
        currentPassword: oldPassword,
        newPassword,
        confirmPassword: newPassword,
        db: client,
      })).resolves.toEqual({ otherSessionsRevoked: 1 });

      await expect(resolveActiveWebSession({ token: tokens.a, now, db: client }))
        .resolves.toMatchObject({ webSessionId: sessionA.session.id });
      await expect(resolveActiveWebSession({ token: tokens.c, now, db: client }))
        .resolves.toBeNull();
      await expect(resolveWorkbenchApiActor(new Request("https://host/api/tasks", {
        headers: {
          cookie: "ht_workbench_session=legacy; ht_workbench_login_email=integration%40invalid; ht_workbench_user_id=legacy-user",
        },
      }))).rejects.toThrow("Workbench API authentication required");
    } finally {
      await cleanFixture();
    }
  }, 30_000);
});

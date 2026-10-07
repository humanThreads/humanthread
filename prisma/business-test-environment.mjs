import "dotenv/config";

import { createHash, pbkdf2Sync } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";
import mysql from "mysql2/promise";

const BUSINESS_TEST_PASSWORD = "humanthread-business-test-only";
const REQUIRED_TABLES = ["Space", "Task", "WebSession", "LoopNodeAttempt"];

function stableId(namespace) {
  return createHash("md5").update(namespace).digest("hex");
}

export function businessTestFixtureIds() {
  return {
    authorizedUserId: stableId("humanthread:business-test:authorized-user"),
    restrictedUserId: stableId("humanthread:business-test:restricted-user"),
    taskAId: stableId("humanthread:business-test:task-a"),
    taskBId: stableId("humanthread:business-test:task-b"),
    taskCId: stableId("humanthread:business-test:task-c"),
  };
}

export function assertBusinessTestDatabaseTarget({ databaseUrl, purpose, allowReset }) {
  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error("Refusing to use an invalid business-test database URL");
  }
  if (
    !["mysql:", "mariadb:"].includes(parsed.protocol)
    || !parsed.hostname
    || !parsed.pathname.slice(1)
    || purpose !== "business-test"
    || allowReset !== "true"
  ) {
    throw new Error("Refusing to modify a database that is not explicitly marked as a business-test database");
  }
  return parsed;
}

function passwordHash(password) {
  const iterations = 210000;
  const salt = "humanthread-business-test-fixture";
  const hash = pbkdf2Sync(password, salt, iterations, 32, "sha256").toString("base64url");
  return `pbkdf2-sha256$${iterations}$${salt}$${hash}`;
}

async function schemaIsCompatible(databaseUrl) {
  const parsed = new URL(databaseUrl);
  const connection = await mysql.createConnection({
    host: parsed.hostname,
    port: Number(parsed.port || 3306),
    user: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
    database: parsed.pathname.slice(1),
  });
  try {
    const [rows] = await connection.query(
      `SELECT COUNT(*) AS tableCount FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (${REQUIRED_TABLES.map(() => "?").join(",")})`,
      REQUIRED_TABLES,
    );
    return Number(rows[0]?.tableCount ?? 0) === REQUIRED_TABLES.length;
  } finally {
    await connection.end();
  }
}

function run(command, args, databaseUrl, extraEnv = {}) {
  const result = spawnSync(command, args, {
    cwd: fileURLToPath(new URL("..", import.meta.url)),
    env: { ...process.env, ...extraEnv, DATABASE_URL: databaseUrl },
    stdio: "inherit",
  });
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status ?? "unknown"}`);
}

async function seedFixtures(databaseUrl) {
  const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });
  const ids = businessTestFixtureIds();
  const commonUser = {
    teamId: "team_1",
    status: "active",
    passwordHash: passwordHash(BUSINESS_TEST_PASSWORD),
    isSiteAdmin: false,
  };
  try {
    await prisma.user.upsert({
      where: { id: ids.authorizedUserId },
      update: { ...commonUser, name: "Business Test Authorized", email: "business-test-authorized@humanthread.invalid" },
      create: { id: ids.authorizedUserId, ...commonUser, name: "Business Test Authorized", email: "business-test-authorized@humanthread.invalid" },
    });
    await prisma.user.upsert({
      where: { id: ids.restrictedUserId },
      update: { ...commonUser, name: "Business Test Restricted", email: "business-test-restricted@humanthread.invalid" },
      create: { id: ids.restrictedUserId, ...commonUser, name: "Business Test Restricted", email: "business-test-restricted@humanthread.invalid" },
    });
    await prisma.companyMember.upsert({
      where: { companyId_userId: { companyId: "company_1", userId: ids.authorizedUserId } },
      update: { role: "member", status: "active" },
      create: { id: stableId("humanthread:business-test:authorized-company-member"), companyId: "company_1", userId: ids.authorizedUserId, role: "member", status: "active" },
    });
    await prisma.companyMember.upsert({
      where: { companyId_userId: { companyId: "company_1", userId: ids.restrictedUserId } },
      update: { role: "viewer", status: "active" },
      create: { id: stableId("humanthread:business-test:restricted-company-member"), companyId: "company_1", userId: ids.restrictedUserId, role: "viewer", status: "active" },
    });
    await prisma.projectMember.upsert({
      where: { projectId_userId: { projectId: "project_1", userId: ids.authorizedUserId } },
      update: { role: "contributor", status: "active" },
      create: { id: stableId("humanthread:business-test:authorized-project-member"), projectId: "project_1", userId: ids.authorizedUserId, role: "contributor", status: "active" },
    });

    const commonTask = {
      teamId: "team_1",
      projectId: "project_1",
      spaceId: "space:company:company_1",
      createdById: ids.authorizedUserId,
      assigneeUserId: ids.authorizedUserId,
      statusCategory: "todo",
      visibility: "project",
      status: "pending",
      executorType: "human",
      queuePosition: 0,
      acceptanceMode: "manual",
      priority: 1,
    };
    for (const fixture of [
      { id: ids.taskAId, shortId: "BIZTESTA", taskNumber: 990001, title: "Business test task A", description: "First non-empty task", contentMarkdown: "# Task A\n\nAuthorized content A." },
      { id: ids.taskBId, shortId: "BIZTESTB", taskNumber: 990002, title: "Business test task B", description: "Second non-empty task", contentMarkdown: "# Task B\n\nAuthorized content B." },
      { id: ids.taskCId, shortId: "BIZTESTC", taskNumber: 990003, title: "Business test task C", description: "Empty-content boundary task", contentMarkdown: "" },
    ]) {
      await prisma.task.upsert({
        where: { id: fixture.id },
        update: { ...commonTask, ...fixture },
        create: { ...commonTask, ...fixture },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
  return ids;
}

export async function prepareBusinessTestEnvironment(env = process.env) {
  const databaseUrl = env.DATABASE_URL?.trim() ?? "";
  assertBusinessTestDatabaseTarget({
    databaseUrl,
    purpose: env.HUMANTHREAD_DATABASE_PURPOSE?.trim() ?? "",
    allowReset: env.HUMANTHREAD_ALLOW_DATABASE_RESET?.trim().toLowerCase() ?? "",
  });
  if (!await schemaIsCompatible(databaseUrl)) {
    run("pnpm", ["exec", "prisma", "db", "push", "--force-reset"], databaseUrl);
  }
  run("pnpm", ["exec", "prisma", "generate"], databaseUrl);
  run("node", ["prisma/seed.mjs"], databaseUrl, { HUMANTHREAD_INITIAL_USER_PASSWORD: BUSINESS_TEST_PASSWORD });
  const ids = await seedFixtures(databaseUrl);
  return { schema: "compatible", fixtures: ids, authorizedEmail: "business-test-authorized@humanthread.invalid", restrictedEmail: "business-test-restricted@humanthread.invalid" };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  prepareBusinessTestEnvironment()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : "Business-test environment preparation failed");
      process.exitCode = 1;
    });
}

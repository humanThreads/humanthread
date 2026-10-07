import "dotenv/config";
import { createHash } from "node:crypto";
import { PrismaMariaDb } from "@prisma/adapter-mariadb";
import { PrismaClient } from "@prisma/client";

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error("DATABASE_URL is required to backfill task business identifiers.");
const prisma = new PrismaClient({ adapter: new PrismaMariaDb(databaseUrl) });

function fallbackCode(name, salt = "") {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/gu, "").slice(0, 8);
  if (letters.length >= 2) return letters;
  return `P${createHash("sha256").update(`${name}:${salt}`).digest("hex").slice(0, 6).toUpperCase()}`;
}

async function main() {
  const projects = await prisma.project.findMany({ orderBy: [{ teamId: "asc" }, { createdAt: "asc" }, { id: "asc" }], select: { id: true, teamId: true, name: true, shortCode: true, nextTaskNumber: true } });
  const tasks = await prisma.task.findMany({ where: { projectId: { not: null } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, projectId: true, taskNumber: true, shortId: true } });
  const usedCodes = new Set(projects.filter((project) => project.shortCode).map((project) => `${project.teamId}:${project.shortCode}`));
  const projectUpdates = new Map();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  for (const project of projects) {
    if (project.shortCode) continue;
    let code = fallbackCode(project.name, project.id);
    let suffix = 0;
    while (usedCodes.has(`${project.teamId}:${code}`)) {
      suffix += 1;
      const suffixText = String(suffix);
      code = `${fallbackCode(project.name, project.id).slice(0, Math.max(2, 12 - suffixText.length))}${suffixText}`.slice(0, 12);
    }
    usedCodes.add(`${project.teamId}:${code}`);
    projectUpdates.set(project.id, { projectId: project.id, shortCode: code, nextTaskNumber: project.nextTaskNumber });
  }
  const taskUpdates = [];
  const usedNumbers = new Map();
  for (const task of tasks) {
    if (task.taskNumber === null || !task.projectId) continue;
    const numbers = usedNumbers.get(task.projectId) ?? new Set();
    numbers.add(task.taskNumber);
    usedNumbers.set(task.projectId, numbers);
  }
  const nextByProject = new Map(projects.map((project) => [project.id, Math.max(100001, project.nextTaskNumber)]));
  for (const task of tasks) {
    if (!task.projectId) continue;
    const project = projectById.get(task.projectId);
    if (!project) continue;
    const code = project.shortCode ?? projectUpdates.get(project.id)?.shortCode;
    if (!code) continue;
    let taskNumber = task.taskNumber;
    let shortId = task.shortId;
    if (taskNumber === null && shortId?.startsWith(code)) {
      const parsed = Number(shortId.slice(code.length));
      if (Number.isSafeInteger(parsed) && parsed >= 100001) {
        taskNumber = parsed;
        const numbers = usedNumbers.get(task.projectId) ?? new Set();
        numbers.add(parsed);
        usedNumbers.set(task.projectId, numbers);
        nextByProject.set(task.projectId, Math.max(nextByProject.get(task.projectId) ?? 100001, parsed + 1));
      }
    }
    if (taskNumber === null) {
      let next = nextByProject.get(task.projectId) ?? 100001;
      const numbers = usedNumbers.get(task.projectId) ?? new Set();
      while (numbers.has(next)) next += 1;
      taskNumber = next;
      numbers.add(next);
      usedNumbers.set(task.projectId, numbers);
      nextByProject.set(task.projectId, next + 1);
    }
    if (!shortId) shortId = `${code}${taskNumber}`;
    if (task.taskNumber !== taskNumber || task.shortId !== shortId) taskUpdates.push({ taskId: task.id, taskNumber, shortId });
  }
  for (const project of projects) {
    const nextTaskNumber = nextByProject.get(project.id) ?? project.nextTaskNumber;
    const update = projectUpdates.get(project.id) ?? { projectId: project.id };
    if (nextTaskNumber !== project.nextTaskNumber) update.nextTaskNumber = nextTaskNumber;
    if (Object.keys(update).length > 1) projectUpdates.set(project.id, update);
  }
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ projects: projectUpdates.size, tasks: taskUpdates.length, dryRun: true }));
    return;
  }
  await prisma.$transaction(async (tx) => {
    for (const update of projectUpdates.values()) {
      const { projectId, ...data } = update;
      await tx.project.update({ where: { id: projectId }, data });
    }
    for (const update of taskUpdates) await tx.task.update({ where: { id: update.taskId }, data: { taskNumber: update.taskNumber, shortId: update.shortId } });
  });
  console.log(JSON.stringify({ projects: projectUpdates.size, tasks: taskUpdates.length, dryRun: false }));
}

main().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => prisma.$disconnect());

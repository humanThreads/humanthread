import { createHash } from "node:crypto";

export interface KnowledgeScheduleInput {
  projectDigest: string;
  rule: string;
  timezone: string;
  now: Date;
  lastScheduledFor?: Date | null;
}

export interface KnowledgeScheduleResult {
  nextAt: Date;
  scheduledFor: string;
  dedupeKey: string;
  due: boolean;
}

export function calculateNextKnowledgeSchedule(input: KnowledgeScheduleInput): KnowledgeScheduleResult {
  const cron = parseCron(input.rule);
  const now = input.now;
  if (Number.isNaN(now.getTime())) throw validationError("Knowledge schedule time is invalid");
  const candidate = new Date(now.getTime());
  candidate.setUTCSeconds(0, 0);
  for (let index = 0; index < 366 * 24 * 60; index += 1) {
    const parts = zonedParts(candidate, input.timezone);
    if (matches(cron.minute, parts.minute) && matches(cron.hour, parts.hour)) {
      const scheduledFor = formatScheduledFor(parts);
      if (input.lastScheduledFor && sameMinute(input.lastScheduledFor, candidate, input.timezone)) {
        candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
        continue;
      }
      return {
        nextAt: new Date(candidate.getTime()),
        scheduledFor,
        dedupeKey: `knowledge-schedule:${createHash("md5").update(["knowledge-schedule", input.projectDigest, input.rule, scheduledFor].join("\0")).digest("hex")}`,
        due: candidate.getTime() === now.getTime() - (now.getTime() % 60_000),
      };
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw validationError("Knowledge schedule has no match within one year");
}

interface ParsedCron {
  minute: Set<number>;
  hour: Set<number>;
}

export function parseKnowledgeCron(rule: string): { minute: number[]; hour: number[] } {
  const parsed = parseCron(rule);
  return { minute: [...parsed.minute].sort((a, b) => a - b), hour: [...parsed.hour].sort((a, b) => a - b) };
}

function parseCron(rule: string): ParsedCron {
  const fields = rule.trim().split(/\s+/u);
  if (fields.length !== 5) throw validationError("Knowledge Cron rule must have five fields");
  if (fields[2] !== "*" || fields[3] !== "*" || fields[4] !== "*") {
    throw validationError("Knowledge Cron currently supports minute and hour fields only");
  }
  return {
    minute: parseField(fields[0]!, 0, 59),
    hour: parseField(fields[1]!, 0, 23),
  };
}

function parseField(value: string, minimum: number, maximum: number): Set<number> {
  const result = new Set<number>();
  for (const part of value.split(",")) {
    const [range, stepValue] = part.split("/");
    const step = stepValue === undefined ? 1 : Number(stepValue);
    if (!Number.isInteger(step) || step < 1) throw validationError("Knowledge Cron step is invalid");
    const [start, end] = range === "*"
      ? [minimum, maximum]
      : range!.includes("-")
        ? range!.split("-").map(Number)
        : [Number(range), Number(range)];
    if (!Number.isInteger(start) || !Number.isInteger(end) || start! < minimum || end! > maximum || start! > end!) {
      throw validationError("Knowledge Cron range is invalid");
    }
    for (let current = start!; current <= end!; current += step) result.add(current);
  }
  if (result.size === 0) throw validationError("Knowledge Cron field is empty");
  return result;
}

function matches(values: Set<number>, value: number): boolean {
  return values.has(value);
}

function zonedParts(date: Date, timezone: string): { year: number; month: number; day: number; hour: number; minute: number } {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function formatScheduledFor(parts: { year: number; month: number; day: number; hour: number; minute: number }): string {
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}`;
}

function sameMinute(left: Date, right: Date, timezone: string): boolean {
  const leftParts = zonedParts(left, timezone);
  const rightParts = zonedParts(right, timezone);
  return formatScheduledFor(leftParts) === formatScheduledFor(rightParts);
}

function validationError(message: string): Error {
  return Object.assign(new Error(message), { code: "validation_failed" });
}

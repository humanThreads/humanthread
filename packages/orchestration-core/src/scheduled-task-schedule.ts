import type { ScheduledTaskStatus } from "@humanthread/shared";

export interface ParsedScheduledTaskCron {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
  dayOfMonthRestricted: boolean;
  dayOfWeekRestricted: boolean;
}

export interface DueScheduledTaskSlot {
  scheduledFor: Date;
  source: "scheduled" | "catch_up";
  nextRunAt: Date;
}

export interface ScheduledTaskTransition {
  status: ScheduledTaskStatus;
  nextRunAt: Date | null;
  pendingScheduledFor: Date | null;
}

const SEARCH_WINDOW_MINUTES = 8 * 366 * 24 * 60;
const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

export function parseScheduledTaskCron(rule: string): ParsedScheduledTaskCron {
  const fields = rule.trim().split(/\s+/u);
  if (fields.length !== 5) throw validationError("Scheduled task Cron must have five fields");
  const minute = parseField(fields[0]!, 0, 59);
  const hour = parseField(fields[1]!, 0, 23);
  const dayOfMonth = parseField(fields[2]!, 1, 31);
  const month = parseField(fields[3]!, 1, 12);
  const dayOfWeek = parseField(fields[4]!, 0, 6);
  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    dayOfMonthRestricted: fields[2] !== "*",
    dayOfWeekRestricted: fields[4] !== "*",
  };
}

export function calculateNextScheduledTaskOccurrence(input: {
  rule: string;
  timezone: string;
  after: Date;
}): Date {
  const cron = parseScheduledTaskCron(input.rule);
  if (Number.isNaN(input.after.getTime())) throw validationError("Scheduled task time is invalid");
  const formatter = getZonedFormatter(input.timezone);
  const candidate = new Date(Math.floor(input.after.getTime() / 60_000) * 60_000 + 60_000);
  for (let index = 0; index < SEARCH_WINDOW_MINUTES; index += 1) {
    const parts = zonedParts(candidate, formatter);
    if (matchesOccurrence(cron, parts) && !isLaterDuplicateWallMinute(candidate, formatter)) return candidate;
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
  }
  throw validationError("Scheduled task Cron has no match within eight years");
}

export function resolveDueScheduledTaskSlot(input: {
  rule: string;
  timezone: string;
  now: Date;
  nextRunAt: Date;
  pendingScheduledFor: Date | null;
  lastScheduledFor: Date | null;
}): DueScheduledTaskSlot | null {
  const first = input.pendingScheduledFor ?? input.nextRunAt;
  if (first > input.now) return null;
  const latest = latestOccurrenceAtOrBefore({ rule: input.rule, timezone: input.timezone, at: input.now });
  const scheduledFor = latest > first ? latest : first;
  return {
    scheduledFor,
    source: input.pendingScheduledFor || scheduledFor > input.nextRunAt ? "catch_up" : "scheduled",
    nextRunAt: calculateNextScheduledTaskOccurrence({ rule: input.rule, timezone: input.timezone, after: scheduledFor }),
  };
}

export function transitionScheduledTaskStatus(
  current: ScheduledTaskStatus,
  command: "enable" | "deactivate" | "disable" | "restore" | "run",
  now: Date,
): ScheduledTaskTransition {
  if (command === "run") {
    if (current === "disabled") throw policyDenied("Disabled scheduled task cannot run");
    return { status: current, nextRunAt: null, pendingScheduledFor: null };
  }
  if (command === "enable") {
    if (current !== "inactive") throw validationError("Only inactive scheduled tasks can be enabled");
    return { status: "enabled", nextRunAt: null, pendingScheduledFor: null };
  }
  if (command === "deactivate") {
    if (current !== "enabled") throw validationError("Only enabled scheduled tasks can be deactivated");
    return { status: "inactive", nextRunAt: null, pendingScheduledFor: null };
  }
  if (command === "disable") {
    return { status: "disabled", nextRunAt: null, pendingScheduledFor: null };
  }
  if (current !== "disabled") throw validationError("Only disabled scheduled tasks can be restored");
  return { status: "inactive", nextRunAt: null, pendingScheduledFor: null };
}

function parseField(value: string, minimum: number, maximum: number): number[] {
  const result = new Set<number>();
  const items = value.split(",");
  if (items.some((item) => item.length === 0)) throw validationError("Scheduled task Cron list item is empty");
  for (const item of items) {
    const slashParts = item.split("/");
    if (slashParts.length > 2 || slashParts[0] === "") throw validationError("Scheduled task Cron step is invalid");
    const range = slashParts[0]!;
    const step = slashParts.length === 1
      ? 1
      : parseUnsignedInteger(slashParts[1]!, "step");
    if (step < 1) throw validationError("Scheduled task Cron step is invalid");

    let start: number;
    let end: number;
    if (range === "*") {
      [start, end] = [minimum, maximum];
    } else {
      const rangeParts = range.split("-");
      if (rangeParts.length > 2 || rangeParts.some((part) => part.length === 0)) {
        throw validationError("Scheduled task Cron range is invalid");
      }
      start = parseUnsignedInteger(rangeParts[0]!, "range");
      end = rangeParts.length === 1 ? start : parseUnsignedInteger(rangeParts[1]!, "range");
    }
    if (start < minimum || end > maximum || start > end) {
      throw validationError("Scheduled task Cron range is invalid");
    }
    for (let current = start; current <= end; current += step) result.add(current);
  }
  if (result.size === 0) throw validationError("Scheduled task Cron field is empty");
  return [...result].sort((left, right) => left - right);
}

function matchesOccurrence(
  cron: ParsedScheduledTaskCron,
  parts: { month: number; dayOfMonth: number; dayOfWeek: number; hour: number; minute: number },
): boolean {
  if (!cron.minute.includes(parts.minute) || !cron.hour.includes(parts.hour) || !cron.month.includes(parts.month)) {
    return false;
  }
  const dayOfMonthMatches = cron.dayOfMonth.includes(parts.dayOfMonth);
  const dayOfWeekMatches = cron.dayOfWeek.includes(parts.dayOfWeek);
  if (cron.dayOfMonthRestricted && cron.dayOfWeekRestricted) return dayOfMonthMatches || dayOfWeekMatches;
  if (cron.dayOfMonthRestricted) return dayOfMonthMatches;
  if (cron.dayOfWeekRestricted) return dayOfWeekMatches;
  return true;
}

function parseUnsignedInteger(value: string, field: "step" | "range"): number {
  if (!/^\d+$/u.test(value)) throw validationError(`Scheduled task Cron ${field} is invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw validationError(`Scheduled task Cron ${field} is invalid`);
  return parsed;
}

function latestOccurrenceAtOrBefore(input: { rule: string; timezone: string; at: Date }): Date {
  const cron = parseScheduledTaskCron(input.rule);
  if (Number.isNaN(input.at.getTime())) throw validationError("Scheduled task time is invalid");
  const formatter = getZonedFormatter(input.timezone);
  const candidate = new Date(Math.floor(input.at.getTime() / 60_000) * 60_000);
  for (let index = 0; index < SEARCH_WINDOW_MINUTES; index += 1) {
    if (matchesOccurrence(cron, zonedParts(candidate, formatter)) && !isLaterDuplicateWallMinute(candidate, formatter)) {
      return candidate;
    }
    candidate.setUTCMinutes(candidate.getUTCMinutes() - 1);
  }
  throw validationError("Scheduled task Cron has no match within eight years");
}

function getZonedFormatter(timezone: string): Intl.DateTimeFormat {
  const cached = zonedFormatters.get(timezone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw validationError("Scheduled task timezone is invalid");
  }
  zonedFormatters.set(timezone, formatter);
  return formatter;
}

function zonedParts(
  date: Date,
  formatter: Intl.DateTimeFormat,
): { year: number; month: number; dayOfMonth: number; dayOfWeek: number; hour: number; minute: number } {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const dayOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday ?? "");
  if (dayOfWeek < 0) throw validationError("Scheduled task weekday is invalid");
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    dayOfMonth: Number(parts.day),
    dayOfWeek,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function isLaterDuplicateWallMinute(date: Date, formatter: Intl.DateTimeFormat): boolean {
  const current = zonedParts(date, formatter);
  for (let minutes = 1; minutes <= 120; minutes += 1) {
    const earlier = zonedParts(new Date(date.getTime() - minutes * 60_000), formatter);
    if (
      current.year === earlier.year
      && current.month === earlier.month
      && current.dayOfMonth === earlier.dayOfMonth
      && current.hour === earlier.hour
      && current.minute === earlier.minute
    ) {
      return true;
    }
  }
  return false;
}

function validationError(message: string): Error & { code: "validation_failed" } {
  return Object.assign(new Error(message), { code: "validation_failed" as const });
}

function policyDenied(message: string): Error & { code: "policy_denied" } {
  return Object.assign(new Error(`policy_denied: ${message}`), { code: "policy_denied" as const });
}

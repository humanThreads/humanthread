import { TZDate } from "@date-fns/tz";
import { endOfDay, format, startOfDay } from "date-fns";

interface CalendarTask {
  id: string;
  shortId: string | null;
  title: string;
  statusCategory: string | null;
  startAt: Date | null;
  dueAt: Date | null;
}

function localDate(date: Date, timeZone: string) {
  return new TZDate(date, timeZone);
}

function parseDateKey(dateKey: string, timeZone: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new TZDate(year!, month! - 1, day!, timeZone);
}

export function getTaskDateRange(input: {
  dateFrom?: string;
  dateTo?: string;
  timeZone: string;
}) {
  return {
    ...(input.dateFrom ? { from: new Date(startOfDay(parseDateKey(input.dateFrom, input.timeZone)).getTime()) } : {}),
    ...(input.dateTo ? { to: new Date(endOfDay(parseDateKey(input.dateTo, input.timeZone)).getTime()) } : {}),
  };
}

export function buildTaskCalendarEntries<T extends CalendarTask>(input: {
  tasks: T[];
  timeZone: string;
  now: Date;
}) {
  const entries = input.tasks.flatMap((task) => {
    const overdue = Boolean(task.dueAt
      && task.dueAt < input.now
      && task.statusCategory !== "completed"
      && task.statusCategory !== "cancelled");
    return [
      ...(task.startAt ? [{
        taskId: task.id,
        shortId: task.shortId,
        title: task.title,
        kind: "start" as const,
        at: task.startAt,
        dateKey: format(localDate(task.startAt, input.timeZone), "yyyy-MM-dd"),
        overdue: false,
      }] : []),
      ...(task.dueAt ? [{
        taskId: task.id,
        shortId: task.shortId,
        title: task.title,
        kind: "due" as const,
        at: task.dueAt,
        dateKey: format(localDate(task.dueAt, input.timeZone), "yyyy-MM-dd"),
        overdue,
      }] : []),
    ];
  }).sort((left, right) => left.at.getTime() - right.at.getTime() || left.taskId.localeCompare(right.taskId));

  return {
    entries,
    unscheduled: input.tasks.filter((task) => !task.startAt && !task.dueAt),
  };
}

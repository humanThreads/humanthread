import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

export interface MonthCalendarEntry {
  id: string;
  dateKey: string;
  title: string;
  kind: "start" | "due";
  overdue: boolean;
  taskId: string;
}

export interface CalendarCell {
  dateKey: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
}

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function monthKey(value: string): string {
  return value.slice(0, 7);
}

export function buildCalendarGrid(year: number, month: number, today = new Date()): CalendarCell[] {
  const first = new Date(year, month - 1, 1);
  const mondayOffset = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - mondayOffset);
  const todayKey = dateKey(today.getFullYear(), today.getMonth() + 1, today.getDate());

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index);
    const key = dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate());
    return {
      dateKey: key,
      day: date.getDate(),
      inMonth: date.getFullYear() === year && date.getMonth() + 1 === month,
      isToday: key === todayKey,
    };
  });
}

export function MonthCalendar(props: {
  entries: readonly MonthCalendarEntry[];
  initialMonth?: string | undefined;
  onOpenTask(taskId: string): void;
}) {
  const initial = props.initialMonth ?? props.entries[0]?.dateKey?.slice(0, 7) ?? monthKey(new Date().toISOString());
  const [visibleMonth, setVisibleMonth] = useState(initial);
  const [year = new Date().getFullYear(), month = 1] = visibleMonth.split("-").map(Number);
  const cells = useMemo(
    () => buildCalendarGrid(year, month),
    [month, year],
  );
  const entriesByDate = useMemo(() => {
    const groups = new Map<string, MonthCalendarEntry[]>();
    for (const entry of props.entries) {
      const current = groups.get(entry.dateKey) ?? [];
      current.push(entry);
      groups.set(entry.dateKey, current);
    }
    return groups;
  }, [props.entries]);
  const monthLabel = `${year} 年 ${month} 月`;

  function moveMonth(offset: number) {
    const next = new Date(year, month - 1 + offset, 1);
    setVisibleMonth(`${next.getFullYear()}-${pad(next.getMonth() + 1)}`);
  }

  function goToday() {
    const now = new Date();
    setVisibleMonth(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`);
  }

  return (
    <section className="month-calendar" aria-label="任务月历">
      <header className="month-calendar-toolbar">
        <div><CalendarDays aria-hidden="true" size={17} /><strong>{monthLabel}</strong></div>
        <div className="toolbar-actions">
          <button className="secondary-button" onClick={goToday} type="button">今天</button>
          <button aria-label="上个月" className="icon-button" onClick={() => moveMonth(-1)} type="button"><ChevronLeft aria-hidden="true" size={17} /></button>
          <button aria-label="下个月" className="icon-button" onClick={() => moveMonth(1)} type="button"><ChevronRight aria-hidden="true" size={17} /></button>
        </div>
      </header>
      <div className="month-calendar-weekdays" aria-hidden="true">
        {WEEKDAYS.map((weekday) => <span key={weekday}>{weekday}</span>)}
      </div>
      <div className="month-calendar-grid">
        {cells.map((cell) => {
          const entries = entriesByDate.get(cell.dateKey) ?? [];
          return (
            <div
              className="month-calendar-day"
              data-in-month={String(cell.inMonth)}
              data-today={String(cell.isToday)}
              key={cell.dateKey}
            >
              <time dateTime={cell.dateKey}>{cell.day}</time>
              <div className="month-calendar-events">
                {entries.map((entry) => (
                  <button
                    className="calendar-event"
                    data-kind={entry.kind}
                    data-overdue={String(entry.overdue)}
                    key={entry.id}
                    onClick={() => props.onOpenTask(entry.taskId)}
                    title={`${entry.kind === "due" ? "截止" : "开始"} · ${entry.title}`}
                    type="button"
                  >
                    {entry.title}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

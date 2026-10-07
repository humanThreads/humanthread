import type { DesktopTaskCollectionResponse } from "@humanthread/workbench-client";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

type TaskCalendarData = DesktopTaskCollectionResponse["data"]["collection"]["calendar"];

const WEEKDAYS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"] as const;

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function buildGrid(month: string): Array<{ key: string; day: number; inMonth: boolean }> {
  const [year = new Date().getFullYear(), monthNumber = 1] = month.split("-").map(Number);
  const first = new Date(year, monthNumber - 1, 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, monthNumber - 1, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    return {
      key: dateKey(date.getFullYear(), date.getMonth() + 1, date.getDate()),
      day: date.getDate(),
      inMonth: date.getFullYear() === year && date.getMonth() + 1 === monthNumber,
    };
  });
}

function shiftMonth(month: string, amount: number): string {
  const [year = new Date().getFullYear(), monthNumber = 1] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + amount, 1);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}`;
}

export function TaskCalendar(props: { calendar: TaskCalendarData; month: string }) {
  const [visibleMonth, setVisibleMonth] = useState(props.month);
  const cells = useMemo(() => buildGrid(visibleMonth), [visibleMonth]);
  const entriesByDate = useMemo(() => {
    const groups = new Map<string, typeof props.calendar.entries>();
    for (const entry of props.calendar.entries) {
      groups.set(entry.dateKey, [...(groups.get(entry.dateKey) ?? []), entry]);
    }
    return groups;
  }, [props.calendar.entries]);
  const [year, monthNumber] = visibleMonth.split("-").map(Number);

  return (
    <div className="task-calendar">
      <header className="task-calendar-toolbar">
        <div><CalendarDays aria-hidden="true" size={17} /><h2>{year} 年 {monthNumber} 月</h2></div>
        <nav aria-label="任务月历月份" className="task-calendar-month-nav">
          <button className="secondary-button" onClick={() => { const now = new Date(); setVisibleMonth(`${now.getFullYear()}-${pad(now.getMonth() + 1)}`); }} type="button">今天</button>
          <button aria-label="上个月" className="icon-button" onClick={() => setVisibleMonth((current) => shiftMonth(current, -1))} type="button"><ChevronLeft aria-hidden="true" size={16} /></button>
          <button aria-label="下个月" className="icon-button" onClick={() => setVisibleMonth((current) => shiftMonth(current, 1))} type="button"><ChevronRight aria-hidden="true" size={16} /></button>
        </nav>
      </header>
      <div className="task-calendar-weekdays" role="row">
        {WEEKDAYS.map((weekday) => <span key={weekday} role="columnheader">{weekday}</span>)}
      </div>
      <div className="task-calendar-grid" role="grid">
        {cells.map((cell) => {
          const entries = entriesByDate.get(cell.key) ?? [];
          return (
            <div className="task-calendar-day" data-in-month={String(cell.inMonth)} key={cell.key} role="gridcell">
              <time dateTime={cell.key}>{cell.day}</time>
              <div>
                {entries.map((entry) => (
                  <Link key={`${entry.kind}:${entry.taskId}`} title={`${entry.kind === "due" ? "截止" : "开始"} · ${entry.title}`} to={`/tasks/${encodeURIComponent(entry.taskId)}`}>
                    {entry.kind === "due" ? "截止" : "开始"} · {entry.title}
                  </Link>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <section aria-label="未排期任务" className="task-unscheduled" role="region">
        <header><h2>未排期</h2><span>{props.calendar.unscheduled.length}</span></header>
        {props.calendar.unscheduled.map((task) => (
          <Link key={task.id} to={`/tasks/${encodeURIComponent(task.id)}`}>{task.title}</Link>
        ))}
        {props.calendar.unscheduled.length === 0 ? <p>所有任务均已排期。</p> : null}
      </section>
    </div>
  );
}

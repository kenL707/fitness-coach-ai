"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Moon } from "lucide-react";
import { isBeforeStart, programBase, summarySig, weekDates, weekdayOf, type ActivePlan, type PlanTask } from "@/lib/fitness";
import { blurOnEnter, cn } from "@/lib/utils";
import { SummaryPanel, type SummaryScope } from "./SummaryPanel";
import { TaskList } from "./TaskList";

export interface PlanActions {
  toggle: (taskId: string) => void;
  edit: (taskId: string, patch: Partial<Pick<PlanTask, "name" | "repsOrDuration">>) => void;
  remove: (taskId: string) => void;
  add: (weekNumber: number, dayName: string) => void;
  reorder: (weekNumber: number, dayName: string, activeId: string, overId: string) => void;
  editFocus: (weekNumber: number, dayName: string, focus: string) => void;
}

interface Props {
  active: ActivePlan;
  actions: PlanActions;
  summary: {
    loadingKeys: string[];
    error: string | null;
    onGenerate: (scope: SummaryScope, weekNumber: number) => void;
    onDismiss: (key: string) => void;
  };
}

const localToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const longDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric", timeZone: "UTC" });
const shortDate = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

const stats = (tasks: PlanTask[]) => {
  const done = tasks.filter((t) => t.completed).length;
  return { done, total: tasks.length, pct: tasks.length ? Math.round((done / tasks.length) * 100) : 0 };
};

export function WeeklyPlan({ active, actions, summary }: Props) {
  const { plan, intake } = active;
  const today = localToday();

  // Open on today's week and day if they fall inside the program, else on the first week.
  const [initial] = useState(() => {
    const idx = Math.floor((Date.parse(today) - Date.parse(programBase(intake))) / (7 * 86_400_000));
    if (today >= intake.startDate && idx >= 0 && idx < plan.weeks.length) return { week: idx, day: weekdayOf(today) as string };
    const first = plan.weeks[0].days[0]?.dayName ?? weekdayOf(intake.startDate);
    return { week: 0, day: first as string };
  });
  const [weekIdx, setWeekIdx] = useState(initial.week);
  const [dayName, setDayName] = useState<string>(initial.day);

  const week = plan.weeks[weekIdx];
  // The 7 calendar days (Monday to Sunday) of this program week, each with its plan day, if any.
  // Days before the start date (only possible in week 1) can't be trained.
  const strip = weekDates(intake, week.weekNumber).map((date) => {
    const name = weekdayOf(date);
    return { date, name, day: week.days.find((d) => d.dayName === name), before: isBeforeStart(intake, date) };
  });
  const selected = strip.find((s) => s.name === dayName) ?? strip.find((s) => s.day) ?? strip[0];

  const weekStats = stats(week.days.flatMap((d) => d.tasks));
  const programStats = stats(plan.weeks.flatMap((w) => w.days.flatMap((d) => d.tasks)));

  // Clamped navigation: never goes before week 1 or past the last week.
  const goWeek = (delta: number) => setWeekIdx((i) => Math.min(plan.weeks.length - 1, Math.max(0, i + delta)));

  const bar = (pct: number, label: string) => (
    <div className="h-3 overflow-hidden rounded-full bg-slate-800" role="progressbar" aria-label={label} aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${pct}%` }} />
    </div>
  );

  const day = selected.day;
  const dayStats = day ? stats(day.tasks) : null;

  return (
    <section aria-label="Weekly plan" className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <div className="mb-5 grid gap-3 sm:grid-cols-2">
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium text-slate-200">Week {week.weekNumber} progress</span>
            <span className="text-slate-400">{weekStats.done}/{weekStats.total} - {weekStats.pct}%</span>
          </div>
          {bar(weekStats.pct, "Week progress")}
        </div>
        <div>
          <div className="mb-1 flex justify-between text-sm">
            <span className="font-medium text-slate-200">Whole program</span>
            <span className="text-slate-400">{programStats.done}/{programStats.total} - {programStats.pct}%</span>
          </div>
          {bar(programStats.pct, "Program progress")}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between gap-2">
        <button type="button" onClick={() => goWeek(-1)} disabled={weekIdx === 0} aria-label="Previous week"
          className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-30">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-center">
          <p className="font-semibold text-white">Week {week.weekNumber} of {plan.weeks.length}</p>
          <p className="text-xs text-slate-400">{shortDate(strip[0].date)} to {shortDate(strip[6].date)}</p>
        </div>
        <button type="button" onClick={() => goWeek(1)} disabled={weekIdx === plan.weeks.length - 1} aria-label="Next week"
          className="rounded-lg border border-slate-700 p-2 text-slate-300 hover:bg-slate-800 disabled:opacity-30">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <div className="mb-4 grid grid-cols-7 gap-1">
        {strip.map((s) => {
          const isSel = s.name === selected.name;
          return (
            <button key={s.date} type="button" onClick={() => setDayName(s.name)} aria-pressed={isSel} title={s.before ? "Before your start date" : undefined}
              className={cn(
                "rounded-lg px-1 py-2 text-center text-xs font-medium transition sm:text-sm",
                isSel ? "bg-emerald-500 text-slate-950" : s.before ? "bg-slate-900 text-slate-600" : s.day ? "bg-slate-800 text-slate-200 hover:bg-slate-700" : "bg-slate-900 text-slate-500 hover:bg-slate-800",
                s.date === today && !isSel && "ring-2 ring-emerald-500/60",
              )}>
              {s.name.slice(0, 3)}
              <span className="block text-[10px] font-normal opacity-80">{shortDate(s.date)}</span>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl bg-slate-950/60 p-4">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-lg font-semibold text-white">
            {longDate(selected.date)}
            {selected.date === today && <span className="ml-2 rounded-full bg-emerald-500/20 px-2 py-0.5 text-xs font-medium text-emerald-300">Today</span>}
          </h3>
          {dayStats && <span className="text-sm text-slate-400">{dayStats.done}/{dayStats.total} done</span>}
        </div>

        {day ? (
          <>
            <div className="mb-4 text-sm">
              <label className="block rounded-lg bg-slate-900 px-3 py-2">
                <input
                  value={day.focus}
                  onChange={(e) => actions.editFocus(week.weekNumber, day.dayName, e.target.value)}
                  onKeyDown={blurOnEnter}
                  aria-label="Day focus"
                  className="block w-full rounded border border-transparent bg-transparent px-1.5 py-0.5 -mx-1.5 text-base font-semibold text-slate-100 sm:text-sm outline-none hover:border-slate-700 focus:border-emerald-500 focus:bg-slate-950"
                />
              </label>
            </div>
            <TaskList
              tasks={day.tasks}
              actions={{
                toggle: actions.toggle,
                edit: actions.edit,
                remove: actions.remove,
                add: () => actions.add(week.weekNumber, day.dayName),
                reorder: (a, o) => actions.reorder(week.weekNumber, day.dayName, a, o),
              }}
            />
          </>
        ) : selected.before ? (
          <p className="flex items-center gap-2 text-sm text-slate-400"><Moon className="h-4 w-4" /> This day is before your start date, so there is nothing to do yet.</p>
        ) : (
          <div className="space-y-3">
            <p className="flex items-center gap-2 text-sm text-slate-400"><Moon className="h-4 w-4" /> Rest day - recover, stay hydrated and keep moving lightly if you like.</p>
            <button type="button" onClick={() => actions.add(week.weekNumber, selected.name)}
              className="inline-flex items-center gap-1 rounded-lg border border-dashed border-slate-700 px-3 py-2 text-sm text-slate-300 hover:border-emerald-500 hover:text-emerald-300">
              + Add your own task
            </button>
          </div>
        )}
      </div>
      <SummaryPanel
        weekNumber={week.weekNumber}
        startDate={intake.startDate}
        sigs={{ week: summarySig(plan, intake, "week", week.weekNumber, today), toDate: summarySig(plan, intake, "to-date", week.weekNumber, today) }}
        summaries={active.summaries ?? {}}
        loadingKeys={summary.loadingKeys}
        error={summary.error}
        onGenerate={summary.onGenerate}
        onDismiss={summary.onDismiss}
      />
    </section>
  );
}

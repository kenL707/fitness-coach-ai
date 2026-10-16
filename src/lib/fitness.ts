import { z } from "zod";

export const DAYS = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
] as const;
export type Weekday = (typeof DAYS)[number];

export const WEEKS = { min: 1, max: 12 } as const;

export const ACTIVITY_OPTIONS = [
  "Strength",
  "HIIT",
  "Yoga",
  "Running",
  "Cycling",
  "Swimming",
  "Pilates",
  "Walking",
  "Mobility",
  "Boxing",
] as const;

export const TIME_OPTIONS = ["15 minutes", "20 minutes", "30 minutes", "45 minutes", "60 minutes", "75 minutes", "90 minutes", "105 minutes", "120 minutes"] as const;

export const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

/* ---------- Intake ---------- */

export interface Intake {
  fitnessGoal: string; // REQUIRED
  startingPoint?: string;
  preferredActivities?: string[];
  programLengthWeeks: number; // REQUIRED, 1-12
  startDate: string; // REQUIRED, YYYY-MM-DD
  currentWeight?: string; // e.g. "175 lbs" or "78 kg"
  preferredDays: string[]; // REQUIRED, at least 1
  timePerDay: Record<string, string>; // REQUIRED for each selected day
  specialConsiderations?: string;
  /** Unit for distance-based work (running, walking, cycling). Missing on older saved plans = miles. */
  distanceUnit?: DistanceUnit;
  /**
   * How program weeks are laid out. Normally "monday": calendar weeks, Monday to Sunday, with a shorter first
   * week if the start date is mid-week. "start" only appears on plans saved before that change, whose weeks
   * ran in 7-day blocks from the start date; it keeps those plans on their original dates.
   */
  weekAnchor?: WeekAnchor;
}

export type WeekAnchor = "monday" | "start";

export type DistanceUnit = "miles" | "km";

export const isValidDateString = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : undefined));

export const intakeSchema = z
  .object({
    fitnessGoal: z.string().trim().min(1, "Fitness goal is required.").max(500),
    startingPoint: optionalText(1000),
    preferredActivities: z.array(z.string().trim().min(1).max(40)).max(15).optional(),
    programLengthWeeks: z.number().finite().transform((n) => clamp(Math.round(n), WEEKS.min, WEEKS.max)),
    startDate: z.string().refine(isValidDateString, "Start date must be a valid YYYY-MM-DD date."),
    currentWeight: optionalText(30),
    preferredDays: z.array(z.enum(DAYS)).min(1, "Select at least one preferred day."),
    timePerDay: z.record(z.string(), z.string().trim().max(40)),
    specialConsiderations: optionalText(1000),
    distanceUnit: z.enum(["miles", "km"]).optional(),
    weekAnchor: z.enum(["monday", "start"]).optional(),
  })
  .superRefine((v, ctx) => {
    for (const day of v.preferredDays) {
      if (!v.timePerDay[day]?.trim()) {
        ctx.addIssue({ code: "custom", path: ["timePerDay", day], message: `Set a duration for ${day}.` });
      }
    }
  })
  .transform((v) => {
    const days = DAYS.filter((d) => v.preferredDays.includes(d));
    return {
      ...v,
      preferredDays: [...days] as string[],
      timePerDay: Object.fromEntries(days.map((d) => [d, v.timePerDay[d].trim()])),
    } satisfies Intake;
  });

/* ---------- Plan (the schema Claude returns and the UI stores) ---------- */

export const planSchema = z.object({
  programTitle: z.string(),
  summary: z.string(),
  weeks: z.array(
    z.object({
      weekNumber: z.number(),
      days: z.array(
        z.object({
          dayName: z.string(),
          focus: z.string(),
          tasks: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              repsOrDuration: z.string(),
              estimatedCalories: z.string(),
              completed: z.boolean(),
            }),
          ),
        }),
      ),
    }),
  ),
});

/**
 * Calories and quantities for one task, estimated once from its title + description (and the client's
 * weight) and then reused by every summary so the same exercise always gets the same number.
 */
export const taskEstimateSchema = z.object({
  calories: z.string(),
  /** Total distance of this one task in the client's distance unit; null if none stated. */
  distance: z.number().nullable(),
  /** Total minutes of this one task; null if none stated. */
  minutes: z.number().nullable(),
  /** Total sets of this one task; null if none stated. */
  sets: z.number().nullable(),
});
export interface TaskEstimate extends z.infer<typeof taskEstimateSchema> {
  /** What the estimate was made from (see estimateKey); stale once the task's text or the weight changes. */
  key: string;
}

export interface PlanTask {
  id: string;
  name: string;
  repsOrDuration: string;
  estimatedCalories: string;
  completed: boolean;
  est?: TaskEstimate;
}
export interface PlanDay {
  dayName: string;
  focus: string;
  tasks: PlanTask[];
}
export interface PlanWeek {
  weekNumber: number;
  days: PlanDay[];
}
export interface ProgramPlan {
  programTitle: string;
  summary: string;
  weeks: PlanWeek[];
}

/** The plan as the browser stores and sends it back (tasks may carry a saved estimate). */
export const storedPlanSchema = z.object({
  programTitle: z.string(),
  summary: z.string(),
  weeks: z.array(
    z.object({
      weekNumber: z.number(),
      days: z.array(
        z.object({
          dayName: z.string(),
          focus: z.string(),
          tasks: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
              repsOrDuration: z.string(),
              estimatedCalories: z.string(),
              completed: z.boolean(),
              est: taskEstimateSchema.extend({ key: z.string() }).optional(),
            }),
          ),
        }),
      ),
    }),
  ),
});

/** Identity of a task's estimate: the same text and weight always map to the same estimate. */
export const estimateKey = (t: { name: string; repsOrDuration: string }, intake: Pick<Intake, "currentWeight" | "distanceUnit">) =>
  [t.name.trim().toLowerCase(), t.repsOrDuration.trim().toLowerCase(), (intake.currentWeight ?? "").trim().toLowerCase(), intake.distanceUnit ?? "miles"].join("|");

/** Per-week generation: each week is requested separately (in parallel) to cut latency. */
export const weekDraftSchema = z.object({
  days: planSchema.shape.weeks.element.shape.days,
});
export const headerSchema = z.object({ programTitle: z.string(), summary: z.string() });
export type WeekDraft = z.infer<typeof weekDraftSchema>;

/* ---------- Progress summaries ---------- */

/** What Claude returns for a summary: how to group the completed tasks, and a short analysis. */
export const summaryAiSchema = z.object({
  groups: z.array(
    z.object({
      activity: z.string(),
      /** How this group's total is reported. */
      measure: z.enum(["distance", "time", "sets", "none"]),
      taskIds: z.array(z.string()),
    }),
  ),
  analysis: z.string(),
});

export interface SummaryGroup {
  activity: string;
  description: string;
  calories: string;
  count: number;
}
export interface ProgressSummary {
  v: 3;
  scope: "week" | "to-date";
  label: string;
  generatedAt: string;
  completed: number;
  total: number;
  totalCalories: string;
  groups: SummaryGroup[];
  analysis: string;
  /** Fingerprint of the data this summary was built from (see summarySig); set by the client. */
  sig?: string;
}

/** What the UI persists under `fitnesscoach_active_plan`. */
export interface ActivePlan {
  plan: ProgramPlan;
  intake: Intake;
  summaries?: Record<string, ProgressSummary>;
  /** The built-in example plan: its summaries are computed locally instead of by the model. */
  example?: boolean;
}

/* ---------- Schedule helpers ---------- */

export const addDays = (date: string, n: number) => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
export const weekdayOf = (date: string): Weekday => DAYS[(new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7];

export interface Slot {
  week: number;
  dayName: Weekday;
  date: string;
  time: string;
}

/**
 * First day of program week 1. Weeks are calendar weeks (Monday to Sunday), so this is the Monday on or
 * before the start date. (Plans saved before that change anchor on the start date itself.)
 */
export function programBase(intake: Pick<Intake, "startDate" | "weekAnchor">): string {
  if (intake.weekAnchor === "start") return intake.startDate;
  const daysSinceMonday = (new Date(`${intake.startDate}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(intake.startDate, -daysSinceMonday);
}

/** Last day of the program (a Sunday for calendar-week plans). */
export const programEnd = (intake: Pick<Intake, "startDate" | "weekAnchor" | "programLengthWeeks">) =>
  addDays(programBase(intake), intake.programLengthWeeks * 7 - 1);

/** The seven dates of a program week, in order. */
export const weekDates = (intake: Pick<Intake, "startDate" | "weekAnchor">, weekNumber: number): string[] =>
  Array.from({ length: 7 }, (_, i) => addDays(programBase(intake), (weekNumber - 1) * 7 + i));

/** Days of the first week that fall before the start date can't be trained. */
export const isBeforeStart = (intake: Pick<Intake, "startDate">, date: string) => date < intake.startDate;

/** One slot per chosen day from the start date on, in date order, grouped into Monday-to-Sunday weeks. */
export function buildSlots(intake: Intake): Slot[] {
  const slots: Slot[] = [];
  for (let w = 1; w <= intake.programLengthWeeks; w++) {
    for (const date of weekDates(intake, w)) {
      const dayName = weekdayOf(date);
      if (isBeforeStart(intake, date) || !intake.preferredDays.includes(dayName)) continue;
      slots.push({ week: w, dayName, date, time: intake.timePerDay[dayName] });
    }
  }
  return slots;
}

/** Date (YYYY-MM-DD) of a given day inside a given program week. */
export function dateFor(intake: Intake, weekNumber: number, dayName: string): string | null {
  return weekDates(intake, weekNumber).find((d) => weekdayOf(d).toLowerCase() === dayName.toLowerCase()) ?? null;
}

export function slotsForWeek(intake: Intake, weekNumber: number) {
  return buildSlots(intake).filter((s) => s.week === weekNumber);
}

/** Normalize one generated week: all chosen days present in order, 2-5 tasks each, unique ids, completed=false. */
export function normalizeWeek(intake: Intake, weekNumber: number, raw: WeekDraft): { week: PlanWeek } | { problem: string } {
  const slots = slotsForWeek(intake, weekNumber);
  // Match "Monday", "monday", "Mon", "Monday (2026-10-12)" etc. to the requested day; fall back to position.
  const used = new Set<number>();
  const days: PlanDay[] = [];
  for (const [di, slot] of slots.entries()) {
    const key = slot.dayName.toLowerCase();
    let idx = raw.days.findIndex((d, i) => !used.has(i) && d.dayName.trim().toLowerCase().startsWith(key.slice(0, 3)));
    if (idx < 0 && raw.days.length === slots.length && !used.has(di)) idx = di;
    const rawDay = idx >= 0 ? raw.days[idx] : undefined;
    if (!rawDay) return { problem: `missing ${slot.dayName} (got: ${raw.days.map((d) => d.dayName).join(", ") || "no days"})` };
    if (rawDay.tasks.length < 1) return { problem: `${slot.dayName} has no tasks` };
    used.add(idx);
    days.push({
      dayName: slot.dayName,
      focus: rawDay.focus,
      tasks: rawDay.tasks.slice(0, 5).map((t, ti) => ({
        id: `w${weekNumber}-d${di + 1}-t${ti + 1}`,
        name: t.name,
        repsOrDuration: t.repsOrDuration,
        estimatedCalories: t.estimatedCalories,
        completed: false,
      })),
    });
  }
  return { week: { weekNumber, days } };
}

/**
 * Fingerprint of everything a summary depends on: how many tasks are in scope and which completed tasks
 * there are (id, title, description). If it changes, an open summary is out of date. Reordering, focus
 * edits and edits to unchecked tasks do not change it. Mirrors the scoping in /api/generate-summary.
 */
export function summarySig(plan: ProgramPlan, intake: Intake, scope: "week" | "to-date", weekNumber: number, today: string): string {
  // Same scoping as the summary route: one shared cutoff (today, or the latest checked-off day anywhere in
  // the program, whichever is later), applied to the week or to the whole program.
  const programDays = plan.weeks.flatMap((w) => w.days.map((d) => ({ week: w.weekNumber, date: dateFor(intake, w.weekNumber, d.dayName) ?? "", tasks: d.tasks })));
  const lastDone = programDays.filter((d) => d.tasks.some((t) => t.completed)).map((d) => d.date).sort().pop();
  const cutoff = lastDone && lastDone > today ? lastDone : today;
  const tasks = programDays
    .filter((d) => (scope === "to-date" || d.week === weekNumber) && d.date && d.date <= cutoff)
    .flatMap((d) => d.tasks);
  const done = tasks.filter((t) => t.completed).map((t) => `${t.id}:${t.name.trim()}:${t.repsOrDuration.trim()}`);
  return `${tasks.length}|${done.sort().join("|")}`;
}

/** Completed tasks that have a title or description to read (the only ones a summary can use). */
export const readableCompleted = (plan: ProgramPlan): PlanTask[] =>
  plan.weeks.flatMap((w) => w.days.flatMap((d) => d.tasks)).filter((t) => t.completed && (t.name.trim() || t.repsOrDuration.trim()));

/** Attach saved estimates to tasks whose text still matches the estimate they were made from. */
export function applyEstimates(plan: ProgramPlan, intake: Intake, estimates: Map<string, TaskEstimate>): ProgramPlan {
  return {
    ...plan,
    weeks: plan.weeks.map((w) => ({
      ...w,
      days: w.days.map((d) => ({
        ...d,
        tasks: d.tasks.map((t) => {
          const est = estimates.get(estimateKey(t, intake));
          return est && (!t.est || t.est.key !== est.key) ? { ...t, est } : t;
        }),
      })),
    })),
  };
}

/** Parse "85" or "70-90" into [low, high]. Unparseable values count as zero. */
export function caloriesRange(value: string): [number, number] {
  const nums = (value.match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length === 0) return [0, 0];
  return [Math.min(...nums), Math.max(...nums)];
}

export function formatCalories([lo, hi]: [number, number]) {
  const r = (n: number) => Math.round(n);
  return r(lo) === r(hi) ? `${r(lo)}` : `${r(lo)}-${r(hi)}`;
}

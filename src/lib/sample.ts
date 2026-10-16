import {
  DAYS,
  addDays,
  caloriesRange,
  dateFor,
  estimateKey,
  formatCalories,
  programBase,
  weekdayOf,
  type ActivePlan,
  type Intake,
  type PlanDay,
  type PlanTask,
  type ProgressSummary,
  type SummaryGroup,
  type TaskEstimate,
} from "@/lib/fitness";

/*
 * A ready-made example plan so visitors can try the app without an API key or any wait. Its summaries are
 * computed locally from the sample tasks' built-in estimates (no network, no cost) using the same
 * scoping rules as the real summaries, so everything stays consistent as you tick tasks.
 */

/** The answers the example plan is "generated" from: a realistic intake, written the way a person would. */
export const EXAMPLE_INPUT = {
  fitnessGoal: "Build the endurance to run my first half marathon this spring",
  startingPoint: "I run about three times a week and am comfortable up to 4 miles. No structured strength training yet, and I sit at a desk most of the day.",
  preferredActivities: ["Running", "Strength"],
  specialConsiderations: "Mild runner's knee on the left side, so no deep lunges or jumping. I only have dumbbells at home on weekdays.",
  currentWeight: "165 lbs",
} as const;

/**
 * A 4-week plan whose week 3 contains `today`, and whose training days always include today's weekday (every
 * other day: today, +2, +4), so the example opens on a day with tasks. Earlier days are mostly done, so the
 * progress bars and summaries have something to show.
 */
export function buildSamplePlan(today: string): ActivePlan {
  const startDate = addDays(programBase({ startDate: today }), -14); // the Monday two weeks before this week's Monday

  // Three training days spaced by a rest day, starting with today: strength, easy run, long run.
  const todayIdx = DAYS.indexOf(weekdayOf(today));
  const trainingDays = [0, 2, 4].map((offset) => DAYS[(todayIdx + offset) % 7]);
  const minutes: Record<number, string> = { 0: "45 minutes", 1: "45 minutes", 2: "90 minutes" };
  const sortedDays = [...trainingDays].sort((a, b) => DAYS.indexOf(a) - DAYS.indexOf(b));

  const intake: Intake = {
    ...EXAMPLE_INPUT,
    preferredActivities: [...EXAMPLE_INPUT.preferredActivities],
    programLengthWeeks: 4,
    startDate,
    preferredDays: sortedDays,
    timePerDay: Object.fromEntries(trainingDays.map((d, i) => [d, minutes[i]])),
    distanceUnit: "miles",
    weekAnchor: "monday",
  };

  const make = (id: string, name: string, repsOrDuration: string, e: Omit<TaskEstimate, "key">): PlanTask => ({
    id,
    name,
    repsOrDuration,
    estimatedCalories: e.calories,
    completed: false,
    est: { key: estimateKey({ name, repsOrDuration }, intake), ...e },
  });
  const strength = (id: string, name: string, sets: number, reps: string, calories: number) =>
    make(id, name, `${sets} x ${reps}`, { calories: String(calories), distance: null, minutes: null, sets });
  const run = (id: string, name: string, miles: number) =>
    make(id, name, `${miles} miles`, { calories: String(Math.round(miles * 100)), distance: miles, minutes: null, sets: null });

  // One template per training day; the strength work is knee-friendly (no deep lunges or jumping).
  const template = (week: number, kind: 0 | 1 | 2): Omit<PlanDay, "dayName"> => {
    const id = (n: number) => `${week}-${kind}-${n}`;
    if (kind === 0) {
      return {
        focus: "Leg strength",
        tasks: [
          strength(id(1), "Box squat to a comfortable depth", 3, "10 reps", 45),
          strength(id(2), "Dumbbell Romanian deadlift", 3, "10 reps", 45),
          strength(id(3), "Plank", 3, `${25 + 5 * week} s`, 20),
        ],
      };
    }
    if (kind === 1) {
      return {
        focus: "Easy aerobic run",
        tasks: [run(id(1), "Easy run", 2 + week * 0.5), strength(id(2), "Flat strides", 6, "20 s", 40)],
      };
    }
    return {
      focus: "Long run",
      tasks: [run(id(1), "Long run", 4 + week), strength(id(2), "Single-leg calf raise", 3, "12 reps", 25)],
    };
  };

  const weeks = [1, 2, 3, 4].map((w) => {
    const days = sortedDays.map((dayName, di) => {
      const kind = trainingDays.indexOf(dayName) as 0 | 1 | 2;
      const t = template(w, kind);
      // Ids follow the plan's usual w{week}-d{day}-t{task} pattern, numbered in calendar order.
      return { dayName, focus: t.focus, tasks: t.tasks.map((task, ti) => ({ ...task, id: `w${w}-d${di + 1}-t${ti + 1}` })) };
    });
    return { weekNumber: w, days };
  });

  // Everything before today is done except one skipped task, so the demo shows realistic progress.
  for (const w of weeks) {
    for (const d of w.days) {
      const date = dateFor(intake, w.weekNumber, d.dayName);
      if (date && date < today) d.tasks.forEach((t) => (t.completed = true));
    }
  }
  weeks[1].days.find((d) => d.focus === "Easy aerobic run")!.tasks[1].completed = false; // skipped the strides in week 2

  return {
    example: true,
    intake,
    plan: {
      programTitle: "Half Marathon Base Builder",
      summary: "3 days a week: knee-friendly leg strength, easy runs and a gradually longer weekend run to build half marathon endurance.",
      weeks,
    },
  };
}

const mdy = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;
const num = (n: number) => String(Math.round(n * 10) / 10);

/** The example's summaries: same cutoff and totals rules as the real ones, computed without any AI call. */
export function buildExampleSummary(active: ActivePlan, scope: "week" | "to-date", weekNumber: number, today: string): ProgressSummary {
  const { plan, intake } = active;
  const programDays = plan.weeks.flatMap((w) =>
    w.days.map((d) => ({ week: w.weekNumber, date: dateFor(intake, w.weekNumber, d.dayName) ?? "", tasks: d.tasks })),
  );
  const lastDone = programDays.filter((d) => d.tasks.some((t) => t.completed)).map((d) => d.date).sort().pop();
  const cutoff = lastDone && lastDone > today ? lastDone : today;
  const tasks = programDays.filter((d) => (scope === "to-date" || d.week === weekNumber) && d.date && d.date <= cutoff).flatMap((d) => d.tasks);
  const done = tasks.filter((t) => t.completed);

  const sumCal = (ts: PlanTask[]) =>
    formatCalories(ts.reduce<[number, number]>((acc, t) => {
      const [lo, hi] = caloriesRange(t.est?.calories ?? t.estimatedCalories);
      return [acc[0] + lo, acc[1] + hi];
    }, [0, 0]));

  const runs = done.filter((t) => /run/i.test(t.name));
  const other = done.filter((t) => !/run/i.test(t.name));
  const groups: SummaryGroup[] = [];
  if (runs.length) {
    const miles = runs.reduce((n, t) => n + (t.est?.distance ?? 0), 0);
    groups.push({ activity: "Running", description: `${num(miles)} miles`, calories: sumCal(runs), count: runs.length });
  }
  if (other.length) {
    const sets = other.reduce((n, t) => n + (t.est?.sets ?? 0), 0);
    groups.push({ activity: "Strength", description: `${sets} sets`, calories: sumCal(other), count: other.length });
  }

  return {
    v: 3,
    scope,
    label: scope === "week" ? `Week ${weekNumber}` : `Since ${mdy(intake.startDate)}`,
    generatedAt: new Date().toISOString(),
    completed: done.length,
    total: tasks.length,
    totalCalories: sumCal(done),
    groups,
    analysis: "This is an example summary, worked out from the sample plan. Create your own plan to get a personalized analysis.",
  };
}

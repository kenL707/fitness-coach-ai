import type { ActivePlan, Intake, PlanTask, ProgramPlan } from "@/lib/fitness";

/** 2026-10-12 is a Monday, so week 1 is Mon Oct 12 - Sun Oct 18 and week 2 is Oct 19 - 25. */
export const makeIntake = (over: Partial<Intake> = {}): Intake => ({
  fitnessGoal: "Build leg strength and improve 5k pace",
  programLengthWeeks: 2,
  startDate: "2026-10-12",
  currentWeight: "175 lbs",
  distanceUnit: "miles",
  preferredDays: ["Monday", "Wednesday", "Friday"],
  timePerDay: { Monday: "45 minutes", Wednesday: "30 minutes", Friday: "60 minutes" },
  ...over,
});

export const task = (id: string, name: string, repsOrDuration = "", completed = false): PlanTask => ({
  id,
  name,
  repsOrDuration,
  estimatedCalories: "",
  completed,
});

/** Two weeks, Mon/Wed/Fri, with 2 tasks per day (so 6 tasks per week, 12 in total). */
export function makePlan(): ProgramPlan {
  const weeks = [1, 2].map((w) => ({
    weekNumber: w,
    days: ["Monday", "Wednesday", "Friday"].map((dayName, di) => ({
      dayName,
      focus: `${dayName} focus`,
      tasks: [task(`w${w}-d${di + 1}-t1`, `Squat ${w}-${di + 1}`, "3 x 10"), task(`w${w}-d${di + 1}-t2`, `Run ${w}-${di + 1}`, "2 miles")],
    })),
  }));
  return { programTitle: "Stronger Legs", summary: "3 days a week: squats and runs.", weeks };
}

export const makeActive = (over: Partial<ActivePlan> = {}): ActivePlan => ({ plan: makePlan(), intake: makeIntake(), ...over });

export const STORAGE_KEY = "fitnesscoach_active_plan";

import { describe, expect, it } from "vitest";
import {
  applyEstimates,
  buildSlots,
  caloriesRange,
  clamp,
  dateFor,
  estimateKey,
  formatCalories,
  intakeSchema,
  isBeforeStart,
  isValidDateString,
  normalizeWeek,
  programBase,
  programEnd,
  readableCompleted,
  summarySig,
  weekDates,
  weekdayOf,
  type TaskEstimate,
} from "@/lib/fitness";
import { makeIntake, makePlan, task } from "@/test/fixtures";

const validBody = () => ({
  fitnessGoal: "Get fit",
  programLengthWeeks: 8,
  startDate: "2026-10-12",
  preferredDays: ["Monday", "Wednesday"],
  timePerDay: { Monday: "30 minutes", Wednesday: "45 minutes" },
});

describe("intake validation", () => {
  it("accepts a minimal valid intake and leaves optional fields undefined", () => {
    const r = intakeSchema.safeParse(validBody());
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.startingPoint).toBeUndefined();
      expect(r.data.currentWeight).toBeUndefined();
      expect(r.data.preferredActivities).toBeUndefined();
      expect(r.data.specialConsiderations).toBeUndefined();
    }
  });

  it("requires a fitness goal (blank or whitespace is rejected)", () => {
    for (const goal of ["", "   "]) {
      const r = intakeSchema.safeParse({ ...validBody(), fitnessGoal: goal });
      expect(r.success).toBe(false);
      if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain("Fitness goal is required.");
    }
  });

  it("requires at least one preferred day", () => {
    const r = intakeSchema.safeParse({ ...validBody(), preferredDays: [], timePerDay: {} });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues.map((i) => i.message)).toContain("Select at least one preferred day.");
  });

  it("requires a duration for every selected day", () => {
    const r = intakeSchema.safeParse({ ...validBody(), timePerDay: { Monday: "30 minutes" } });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues.map((i) => i.message)).toEqual(["Set a duration for Wednesday."]);
      expect(r.error.issues[0].path).toEqual(["timePerDay", "Wednesday"]);
    }
  });

  it("rejects unknown day names", () => {
    expect(intakeSchema.safeParse({ ...validBody(), preferredDays: ["Funday"] }).success).toBe(false);
  });

  it.each([
    [0, 1],
    [-5, 1],
    [1, 1],
    [8, 8],
    [12, 12],
    [13, 12],
    [99, 12],
    [3.6, 4],
  ])("clamps program length %s -> %s weeks (1 to 12)", (input, expected) => {
    const r = intakeSchema.parse({ ...validBody(), programLengthWeeks: input });
    expect(r.programLengthWeeks).toBe(expected);
  });

  it.each([["2026-13-01"], ["2026-02-30"], ["10-12-2026"], ["2026/10/12"], [""], ["not a date"]])("rejects invalid start date %j", (d) => {
    expect(intakeSchema.safeParse({ ...validBody(), startDate: d }).success).toBe(false);
  });

  it("accepts real dates including leap days", () => {
    expect(isValidDateString("2028-02-29")).toBe(true);
    expect(isValidDateString("2027-02-29")).toBe(false);
  });

  it("normalizes days into week order and drops times for unselected days", () => {
    const r = intakeSchema.parse({
      ...validBody(),
      preferredDays: ["Wednesday", "Monday"],
      timePerDay: { Monday: " 30 minutes ", Wednesday: "45 minutes", Friday: "90 minutes" },
    });
    expect(r.preferredDays).toEqual(["Monday", "Wednesday"]);
    expect(r.timePerDay).toEqual({ Monday: "30 minutes", Wednesday: "45 minutes" });
  });

  it("accepts the 120 minute option and a distance unit", () => {
    const r = intakeSchema.parse({ ...validBody(), timePerDay: { Monday: "120 minutes", Wednesday: "105 minutes" }, distanceUnit: "km" });
    expect(r.timePerDay.Monday).toBe("120 minutes");
    expect(r.distanceUnit).toBe("km");
    expect(intakeSchema.safeParse({ ...validBody(), distanceUnit: "furlongs" }).success).toBe(false);
  });
});

describe("clamp", () => {
  it("keeps values inside the range", () => {
    expect(clamp(5, 1, 12)).toBe(5);
    expect(clamp(0, 1, 12)).toBe(1);
    expect(clamp(100, 1, 12)).toBe(12);
  });
});

describe("scheduling", () => {
  it("builds one slot per chosen day per week, in date order, with that day's time", () => {
    const slots = buildSlots(makeIntake());
    expect(slots).toHaveLength(6);
    expect(slots.map((s) => `${s.week}:${s.dayName}:${s.date}`)).toEqual([
      "1:Monday:2026-10-12",
      "1:Wednesday:2026-10-14",
      "1:Friday:2026-10-16",
      "2:Monday:2026-10-19",
      "2:Wednesday:2026-10-21",
      "2:Friday:2026-10-23",
    ]);
    expect(slots[0].time).toBe("45 minutes");
    expect(slots[2].time).toBe("60 minutes");
  });

  it("lays weeks out as Monday-Sunday calendar weeks, with a shorter first week for a mid-week start", () => {
    // Thursday Oct 15 start, training Mon + Thu: week 1 (Oct 12-18) only has Thursday; Monday Oct 12 is before the start.
    const intake = makeIntake({ startDate: "2026-10-15", programLengthWeeks: 2, preferredDays: ["Monday", "Thursday"], timePerDay: { Monday: "30 minutes", Thursday: "30 minutes" } });
    expect(buildSlots(intake).map((s) => `${s.week}:${s.dayName}:${s.date}`)).toEqual(["1:Thursday:2026-10-15", "2:Monday:2026-10-19", "2:Thursday:2026-10-22"]);
    expect(programBase(intake)).toBe("2026-10-12"); // the Monday on or before the start date
    expect(programEnd(intake)).toBe("2026-10-25"); // the Sunday that closes week 2
    expect(weekDates(intake, 1)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
    expect(weekdayOf(weekDates(intake, 2)[0])).toBe("Monday");
  });

  it("flags days before the start date, and a Monday start has none", () => {
    const thu = makeIntake({ startDate: "2026-10-15" });
    expect(isBeforeStart(thu, "2026-10-14")).toBe(true);
    expect(isBeforeStart(thu, "2026-10-15")).toBe(false);
    const mon = makeIntake();
    expect(programBase(mon)).toBe("2026-10-12");
    expect(weekDates(mon, 1).some((d) => isBeforeStart(mon, d))).toBe(false);
  });

  it("handles a Sunday start (week 1 is a single day) and a first week with no training days", () => {
    const intake = makeIntake({ startDate: "2026-10-18", programLengthWeeks: 2 }); // Sunday; trains Mon/Wed/Fri
    expect(programBase(intake)).toBe("2026-10-12");
    expect(buildSlots(intake).filter((s) => s.week === 1)).toEqual([]);
    expect(buildSlots(intake).filter((s) => s.week === 2)).toHaveLength(3);
  });

  it("keeps plans saved with the old layout on their original dates (weekAnchor: start)", () => {
    const legacy = makeIntake({ startDate: "2026-10-15", programLengthWeeks: 1, preferredDays: ["Monday", "Thursday"], timePerDay: { Monday: "30 minutes", Thursday: "30 minutes" }, weekAnchor: "start" });
    expect(programBase(legacy)).toBe("2026-10-15");
    expect(buildSlots(legacy).map((s) => `${s.dayName}:${s.date}`)).toEqual(["Thursday:2026-10-15", "Monday:2026-10-19"]);
    expect(dateFor(legacy, 1, "Monday")).toBe("2026-10-19");
  });

  it("finds the date of a day inside a program week", () => {
    const intake = makeIntake();
    expect(dateFor(intake, 1, "Monday")).toBe("2026-10-12");
    expect(dateFor(intake, 2, "friday")).toBe("2026-10-23");
    expect(dateFor(intake, 3, "Monday")).toBe("2026-10-26"); // week numbers past the end still resolve
    expect(dateFor(makeIntake({ startDate: "2026-10-15" }), 1, "Monday")).toBe("2026-10-12"); // Monday of the start date's week
  });
});

describe("normalizeWeek (validating a generated week)", () => {
  const rawDay = (dayName: string, n = 3) => ({
    dayName,
    focus: `${dayName} focus`,
    tasks: Array.from({ length: n }, (_, i) => ({ id: "x", name: `T${i}`, repsOrDuration: "r", estimatedCalories: "10", completed: true })),
  });
  const intake = makeIntake();

  it("produces every chosen day in order with fresh ids and completed=false", () => {
    const r = normalizeWeek(intake, 1, { days: [rawDay("Friday"), rawDay("Monday"), rawDay("Wednesday")] });
    expect("week" in r).toBe(true);
    if ("week" in r) {
      expect(r.week.days.map((d) => d.dayName)).toEqual(["Monday", "Wednesday", "Friday"]);
      expect(r.week.days[0].tasks.map((t) => t.id)).toEqual(["w1-d1-t1", "w1-d1-t2", "w1-d1-t3"]);
      expect(r.week.days.flatMap((d) => d.tasks).every((t) => t.completed === false)).toBe(true);
    }
  });

  it("tolerates abbreviated or decorated day names", () => {
    const r = normalizeWeek(intake, 1, { days: [rawDay("Mon"), rawDay("wednesday (2026-10-14)"), rawDay("FRI")] });
    expect("week" in r).toBe(true);
  });

  it("falls back to position when the names are unrecognisable but the count matches", () => {
    const r = normalizeWeek(intake, 1, { days: [rawDay("Day 1"), rawDay("Day 2"), rawDay("Day 3")] });
    expect("week" in r && r.week.days.map((d) => d.dayName)).toEqual(["Monday", "Wednesday", "Friday"]);
  });

  it("reports which day is missing (the intermittent model slip)", () => {
    const r = normalizeWeek(intake, 1, { days: [rawDay("Monday")] });
    expect("problem" in r && r.problem).toMatch(/missing Wednesday \(got: Monday\)/);
  });

  it("rejects a day with no tasks and caps tasks at five", () => {
    const empty = normalizeWeek(intake, 1, { days: [rawDay("Monday", 0), rawDay("Wednesday"), rawDay("Friday")] });
    expect("problem" in empty && empty.problem).toMatch(/Monday has no tasks/);
    const many = normalizeWeek(intake, 1, { days: [rawDay("Monday", 9), rawDay("Wednesday"), rawDay("Friday")] });
    expect("week" in many && many.week.days[0].tasks).toHaveLength(5);
  });
});

describe("calorie helpers", () => {
  it("parses single values and ranges", () => {
    expect(caloriesRange("85")).toEqual([85, 85]);
    expect(caloriesRange("70-90")).toEqual([70, 90]);
    expect(caloriesRange("70 - 90 kcal")).toEqual([70, 90]);
    expect(caloriesRange("")).toEqual([0, 0]);
    expect(caloriesRange("abc")).toEqual([0, 0]);
  });
  it("formats singles and ranges", () => {
    expect(formatCalories([85, 85])).toBe("85");
    expect(formatCalories([70, 90])).toBe("70-90");
    expect(formatCalories([84.6, 85.2])).toBe("85");
  });
});

describe("saved estimates", () => {
  const intake = makeIntake();
  const est = (key: string): TaskEstimate => ({ key, calories: "123", distance: 2, minutes: null, sets: null });

  it("keys ignore case/whitespace but change with the text, weight and unit", () => {
    const a = estimateKey({ name: "Run 2 miles", repsOrDuration: "" }, intake);
    expect(estimateKey({ name: "  run 2 MILES ", repsOrDuration: "" }, intake)).toBe(a);
    expect(estimateKey({ name: "Run 3 miles", repsOrDuration: "" }, intake)).not.toBe(a);
    expect(estimateKey({ name: "Run 2 miles", repsOrDuration: "" }, { ...intake, currentWeight: "180 lbs" })).not.toBe(a);
    expect(estimateKey({ name: "Run 2 miles", repsOrDuration: "" }, { ...intake, distanceUnit: "km" })).not.toBe(a);
  });

  it("attaches an estimate to every task with the same text, and leaves others alone", () => {
    const plan = makePlan();
    plan.weeks[0].days[0].tasks[0] = task("a", "run 2 miles");
    plan.weeks[1].days[0].tasks[0] = task("b", "Run 2 Miles");
    const key = estimateKey({ name: "run 2 miles", repsOrDuration: "" }, intake);
    const out = applyEstimates(plan, intake, new Map([[key, est(key)]]));
    expect(out.weeks[0].days[0].tasks[0].est?.calories).toBe("123");
    expect(out.weeks[1].days[0].tasks[0].est?.calories).toBe("123");
    expect(out.weeks[0].days[0].tasks[1].est).toBeUndefined();
    expect(plan.weeks[0].days[0].tasks[0].est).toBeUndefined(); // input not mutated
  });

  it("lists only completed tasks that have text", () => {
    const plan = makePlan();
    plan.weeks[0].days[0].tasks = [task("a", "x", "", true), task("b", "", "30 min bike", true), task("c", "", "", true), task("d", "y", "", false)];
    expect(readableCompleted(plan).map((t) => t.id)).toEqual(["a", "b"]);
  });
});

describe("summarySig (what makes an open summary stale)", () => {
  const intake = makeIntake();
  const today = "2026-10-14";

  it("changes when a task is completed, added, or a completed task is edited", () => {
    const plan = makePlan();
    const base = summarySig(plan, intake, "week", 1, today);
    const checked = makePlan();
    checked.weeks[0].days[0].tasks[0].completed = true;
    expect(summarySig(checked, intake, "week", 1, today)).not.toBe(base);

    const edited = makePlan();
    edited.weeks[0].days[0].tasks[0].completed = true;
    const sigBefore = summarySig(edited, intake, "week", 1, today);
    edited.weeks[0].days[0].tasks[0].name = "Something else";
    expect(summarySig(edited, intake, "week", 1, today)).not.toBe(sigBefore);

    const added = makePlan();
    added.weeks[0].days[0].tasks.push(task("n", "new"));
    expect(summarySig(added, intake, "week", 1, today)).not.toBe(base);
  });

  it("ignores reordering, focus edits and edits to unchecked tasks", () => {
    const base = summarySig(makePlan(), intake, "week", 1, today);
    const p = makePlan();
    p.weeks[0].days[0].tasks.reverse();
    p.weeks[0].days[0].focus = "Totally new focus";
    p.weeks[0].days[1].tasks[0].name = "renamed but not done";
    expect(summarySig(p, intake, "week", 1, today)).toBe(base);
  });

  it("only counts tasks through today (or the latest checked-off day)", () => {
    const plan = makePlan();
    // today = Wed Oct 14: week 1 has Mon + Wed in scope (4 tasks), Friday not yet.
    expect(summarySig(plan, intake, "week", 1, today).split("|")[0]).toBe("4");
    // Checking off a task on Friday Oct 16 pulls Friday into scope too.
    plan.weeks[0].days[2].tasks[0].completed = true;
    expect(summarySig(plan, intake, "week", 1, today).split("|")[0]).toBe("6");
  });

  it("uses the same cutoff for the week and since-start views, so week totals add up", () => {
    const plan = makePlan();
    plan.weeks[1].days[1].tasks[0].completed = true; // Wed Oct 21, a future day
    const count = (scope: "week" | "to-date", wk: number) => Number(summarySig(plan, intake, scope, wk, today).split("|")[0]);
    expect(count("week", 1) + count("week", 2)).toBe(count("to-date", 1));
    expect(count("to-date", 1)).toBe(10); // all of week 1 (6) + Mon & Wed of week 2 (4)
  });
});

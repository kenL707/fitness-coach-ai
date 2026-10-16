import { describe, expect, it } from "vitest";
import { DAYS, dateFor, estimateKey, programBase, summarySig, weekdayOf } from "@/lib/fitness";
import { buildExampleSummary, buildSamplePlan } from "@/lib/sample";

// A Wednesday: the sample always puts "today" in week 3 of 4 and trains today, +2 and +4 days (Wed, Fri, Sun).
const TODAY = "2026-10-28";

describe("example plan", () => {
  const sample = buildSamplePlan(TODAY);

  it("is a 4-week, 3-days-a-week plan starting on a Monday two weeks before this week", () => {
    expect(sample.example).toBe(true);
    expect(sample.plan.weeks).toHaveLength(4);
    expect(sample.plan.weeks.every((w) => w.days.map((d) => d.dayName).join() === "Wednesday,Friday,Sunday")).toBe(true);
    expect(weekdayOf(sample.intake.startDate)).toBe("Monday");
    expect(sample.intake.startDate).toBe("2026-10-12");
    expect(programBase({ startDate: TODAY })).toBe("2026-10-26"); // this week's Monday: the start of week 3
    expect(sample.intake.weekAnchor).toBe("monday");
  });

  it("has progress before today (all done but one skipped task) and nothing completed from today on", () => {
    for (const w of sample.plan.weeks) {
      for (const d of w.days) {
        const date = dateFor(sample.intake, w.weekNumber, d.dayName)!;
        for (const t of d.tasks) {
          if (date >= TODAY) expect(t.completed, `${t.id} on ${date}`).toBe(false);
        }
      }
    }
    expect(sample.plan.weeks[1].days[1].tasks[1].completed).toBe(false); // the one skipped task (week 2 strides)
    expect(sample.plan.weeks[0].days.flatMap((d) => d.tasks).every((t) => t.completed)).toBe(true);
  });

  it("always trains today, whatever day of the week the visitor arrives", () => {
    for (let i = 0; i < 7; i++) {
      const day = `2026-10-${String(12 + i).padStart(2, "0")}`; // Mon Oct 12 .. Sun Oct 18
      const s = buildSamplePlan(day);
      const name = weekdayOf(day);
      expect(s.intake.preferredDays, day).toContain(name);
      expect(s.intake.preferredDays).toHaveLength(3);
      const todaysTasks = s.plan.weeks[2].days.find((d) => d.dayName === name)!.tasks;
      expect(todaysTasks.length, day).toBeGreaterThan(0);
      expect(todaysTasks.every((t) => !t.completed)).toBe(true); // today's work is still to do
      // The plan's days stay in calendar order inside each week.
      const order = s.plan.weeks[0].days.map((d) => DAYS.indexOf(d.dayName as (typeof DAYS)[number]));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("uses a realistic, knee-friendly example intake", () => {
    expect(sample.intake.fitnessGoal).toMatch(/half marathon/i);
    expect(sample.intake.specialConsiderations).toMatch(/knee/i);
    const names = sample.plan.weeks.flatMap((w) => w.days.flatMap((d) => d.tasks.map((t) => t.name.toLowerCase())));
    expect(names.some((n) => /lunge|jump/.test(n))).toBe(false); // honours "no deep lunges or jumping"
  });

  it("carries a valid saved estimate on every task, so it never needs the model", () => {
    for (const t of sample.plan.weeks.flatMap((w) => w.days.flatMap((d) => d.tasks))) {
      expect(t.est, t.id).toBeDefined();
      expect(t.est!.key).toBe(estimateKey(t, sample.intake));
    }
  });
});

describe("example summaries (computed locally)", () => {
  const sample = buildSamplePlan(TODAY);

  it("total the completed tasks and report distance and sets", () => {
    const wk1 = buildExampleSummary(sample, "week", 1, TODAY);
    // week 1: Easy run 2.5 mi + Long run 5 mi, all strength done; every task counted
    expect(wk1.groups.find((g) => g.activity === "Running")).toMatchObject({ description: "7.5 miles", calories: "750", count: 2 });
    expect(wk1.groups.find((g) => g.activity === "Strength")?.description).toBe("18 sets"); // 9 + 6 + 3
    expect(wk1.completed).toBe(wk1.total);
    expect(wk1.v).toBe(3);
  });

  it("use one shared cutoff so weekly totals add up to the since-start total", () => {
    const week = (n: number) => buildExampleSummary(sample, "week", n, TODAY);
    const all = buildExampleSummary(sample, "to-date", 1, TODAY);
    const sumWeeks = [1, 2, 3, 4].map(week);
    expect(sumWeeks.reduce((n, s) => n + s.total, 0)).toBe(all.total);
    expect(sumWeeks.reduce((n, s) => n + s.completed, 0)).toBe(all.completed);
    expect(all.label).toBe("Since 10-12-2026");
  });

  it("move when a task is ticked, and the change is detected as stale by the signature", () => {
    const before = buildExampleSummary(sample, "to-date", 1, TODAY);
    const sigBefore = summarySig(sample.plan, sample.intake, "to-date", 1, TODAY);
    const ticked = structuredClone(sample);
    ticked.plan.weeks[2].days[0].tasks[0].completed = true; // Wednesday of week 3: today, so not done yet
    const after = buildExampleSummary(ticked, "to-date", 1, TODAY);
    expect(after.completed).toBe(before.completed + 1);
    expect(summarySig(ticked.plan, ticked.intake, "to-date", 1, TODAY)).not.toBe(sigBefore);
  });
});

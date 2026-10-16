import { beforeEach, describe, expect, it, vi } from "vitest";
import { create, reply, systemOf, userOf } from "@/test/anthropic-mock";
import { estimateKey, type ProgramPlan, type ProgressSummary } from "@/lib/fitness";
import { makeIntake, makePlan, task } from "@/test/fixtures";

// The factory runs before static imports are initialised, so it loads the shared fake lazily.
vi.mock("@anthropic-ai/sdk", async () => (await import("@/test/anthropic-mock")).anthropicModule());

import { POST } from "./route";

type Args = { system?: unknown; messages: { content: unknown }[] };
const isEstimate = (a: Args) => systemOf(a).includes("For EVERY task id given");
const estimateCalls = () => create.mock.calls.map(([a]) => a as Args).filter(isEstimate);

/**
 * Fake model. Estimates: "N miles" anywhere in a task = N distance and 100 kcal per mile; "N min" = N minutes
 * at 10 kcal/min; everything else 50 kcal. Grouping: runs together as "Run" (the app should relabel it
 * "Running"), everything else in one group per distinct name.
 */
const wellBehaved = () =>
  create.mockImplementation(async (args: Args) => {
    const user = userOf(args);
    if (isEstimate(args)) {
      const tasks = [...user.matchAll(/^(t\d+) \| name: (.*) \| detail: (.*)$/gm)].map(([, id, name, detail]) => {
        const text = `${name} ${detail}`;
        const miles = /(\d+(?:\.\d+)?)\s*miles?/i.exec(text);
        const mins = /(\d+)\s*min/i.exec(text);
        return {
          id,
          calories: miles ? String(Number(miles[1]) * 100) : mins ? String(Number(mins[1]) * 10) : "50",
          distance: miles ? Number(miles[1]) : null,
          minutes: mins ? Number(mins[1]) : null,
          sets: null,
        };
      });
      return reply({ tasks });
    }
    const lines = [...user.matchAll(/^(\S+) \| .*? \| name: (.*?) \| detail: (.*?) \| known:/gm)];
    const groups = new Map<string, string[]>();
    for (const [, id, name, detail] of lines) {
      const label = /run|mile/i.test(`${name} ${detail}`) ? "Run" : name;
      groups.set(label, [...(groups.get(label) ?? []), id]);
    }
    return reply({
      groups: [...groups].map(([activity, taskIds]) => ({ activity, measure: activity === "Run" ? "distance" : "none", taskIds })),
      analysis: "Nice work <br/> keep going.",
    });
  });

const post = (over: Record<string, unknown>) =>
  POST(new Request("http://test/api/generate-summary", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(over) }));

const request = (plan: ProgramPlan, over: Record<string, unknown> = {}) => ({ intake: makeIntake(), plan, scope: "week", weekNumber: 1, asOf: "2026-10-14", ...over });
const summarize = async (plan: ProgramPlan, over: Record<string, unknown> = {}) => {
  const res = await post(request(plan, over));
  return { res, json: (await res.json()) as ProgressSummary & { error?: string; estimates?: Record<string, unknown> } };
};

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/generate-summary: validation", () => {
  it("400s on a malformed request and names the problem", async () => {
    const res = await post({ intake: makeIntake(), plan: makePlan(), scope: "week", asOf: "yesterday" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/asOf/);
    expect(create).not.toHaveBeenCalled();
  });

  it("400s for an unknown week and 500s without an API key", async () => {
    expect((await post(request(makePlan(), { weekNumber: 9 }))).status).toBe(400);
    delete process.env.ANTHROPIC_API_KEY;
    expect((await post(request(makePlan()))).status).toBe(500);
  });
});

describe("POST /api/generate-summary: totals and grouping", () => {
  it("sums calories and distance per group from the saved per-task estimates", async () => {
    wellBehaved();
    const plan = makePlan();
    plan.weeks[0].days[0].tasks = [task("a", "run 2 miles", "", true), task("b", "", "3 miles easy", true), task("c", "Easy run", "5 km", false)];
    const { json } = await summarize(plan);

    expect(json.completed).toBe(2);
    const run = json.groups.find((g) => g.activity === "Running")!;
    expect(run).toBeDefined(); // "Run" relabelled to the canonical "Running"
    expect(run.description).toBe("5 miles");
    expect(run.calories).toBe("500");
    expect(json.totalCalories).toBe("500");
  });

  it("strips markup from the analysis", async () => {
    wellBehaved();
    const plan = makePlan();
    plan.weeks[0].days[0].tasks[0].completed = true;
    const { json } = await summarize(plan);
    expect(json.analysis).toBe("Nice work keep going.");
  });

  it("estimates once per distinct task text and reuses it for repeats", async () => {
    wellBehaved();
    const plan = makePlan();
    plan.weeks[0].days[0].tasks = [task("a", "run 4.5 miles", "", true)];
    plan.weeks[0].days[1].tasks = [task("b", "Run 4.5 Miles", "", true)];
    plan.weeks[0].days[2].tasks = [task("c", "  run 4.5 miles ", "", true)];
    const { json } = await summarize(plan);

    expect(estimateCalls()).toHaveLength(1);
    const lines = userOf(estimateCalls()[0]).match(/^t\d+ \|/gm) ?? [];
    expect(lines).toHaveLength(1); // three tasks, one distinct text
    expect(json.groups[0].description).toBe("13.5 miles");
    expect(json.groups[0].calories).toBe("1350"); // identical per-task numbers: 3 x 450
  });

  it("uses saved estimates without calling the model again, and re-estimates when the text changes", async () => {
    wellBehaved();
    const intake = makeIntake();
    const plan = makePlan();
    const t = task("a", "run 2 miles", "", true);
    t.est = { key: estimateKey(t, intake), calories: "777", distance: 2, minutes: null, sets: null };
    plan.weeks[0].days[0].tasks = [t];

    const reused = await summarize(plan);
    expect(estimateCalls()).toHaveLength(0);
    expect(reused.json.totalCalories).toBe("777");

    create.mockClear();
    t.name = "run 3 miles"; // text changed: the saved estimate no longer applies
    const fresh = await summarize(plan);
    expect(estimateCalls()).toHaveLength(1);
    expect(fresh.json.totalCalories).toBe("300");
  });

  it("returns the estimates it made so the page can save them", async () => {
    wellBehaved();
    const plan = makePlan();
    plan.weeks[0].days[0].tasks = [task("a", "run 2 miles", "", true)];
    const { json } = await summarize(plan);
    expect(Object.keys(json.estimates ?? {})).toEqual([estimateKey(plan.weeks[0].days[0].tasks[0], makeIntake())]);
  });

  it("counts a completed task with no title or description but skips the model when nothing is readable", async () => {
    wellBehaved();
    const plan = makePlan();
    plan.weeks[0].days[0].tasks = [task("a", "", "", true)];
    const { json } = await summarize(plan);
    expect(create).not.toHaveBeenCalled();
    expect(json.completed).toBe(1);
    expect(json.totalCalories).toBe("0");
    expect(json.analysis).toMatch(/no title or description/);
  });

  it("falls back to the plan's own estimate when the model returns an unusable one", async () => {
    create.mockImplementation(async (args: Args) => {
      if (isEstimate(args)) return reply({ tasks: [{ id: "t0", calories: "lots", distance: null, minutes: null, sets: null }] });
      return reply({ groups: [{ activity: "Strength", measure: "none", taskIds: ["a"] }], analysis: "ok" });
    });
    const plan = makePlan();
    const t = task("a", "Squats", "3 x 10", true);
    t.estimatedCalories = "45";
    plan.weeks[0].days[0].tasks = [t];
    const { json } = await summarize(plan);
    expect(json.totalCalories).toBe("45");
  });

  it("puts tasks the model forgot to group into 'Other' and ignores made-up ids", async () => {
    create.mockImplementation(async (args: Args) => {
      if (isEstimate(args)) return reply({ tasks: [0, 1].map((i) => ({ id: `t${i}`, calories: "100", distance: null, minutes: null, sets: null })) });
      return reply({ groups: [{ activity: "Strength", measure: "none", taskIds: ["a", "ghost"] }], analysis: "ok" });
    });
    const plan = makePlan();
    plan.weeks[0].days[0].tasks = [task("a", "Squats", "", true), task("b", "Lunges", "", true)];
    const { json } = await summarize(plan);
    expect(json.groups.map((g) => [g.activity, g.count, g.calories])).toEqual([
      ["Strength", 1, "100"],
      ["Other", 1, "100"],
    ]);
    expect(json.totalCalories).toBe("200");
  });
});

describe("POST /api/generate-summary: which tasks count (shared cutoff)", () => {
  const withProgress = () => {
    const plan = makePlan();
    plan.weeks[0].days[0].tasks[0].completed = true; // Mon Oct 12
    plan.weeks[1].days[1].tasks.push(task("c-1", "run 3 miles", "", true)); // Wed Oct 21: a future day
    return plan;
  };

  it("counts through today, or the latest checked-off day if that is later; weekly totals add up to since-start", async () => {
    wellBehaved();
    const plan = withProgress();
    const wk1 = (await summarize(plan, { scope: "week", weekNumber: 1 })).json;
    const wk2 = (await summarize(plan, { scope: "week", weekNumber: 2 })).json;
    const all = (await summarize(plan, { scope: "to-date", weekNumber: 1 })).json;

    // Cutoff is Oct 21 (the checked-off future day): all 6 week-1 tasks, and Mon + Wed (5) of week 2.
    expect(wk1.total).toBe(6);
    expect(wk2.total).toBe(5);
    expect(all.total).toBe(11);
    expect(wk1.total + wk2.total).toBe(all.total);
    expect(wk1.completed + wk2.completed).toBe(all.completed);
    expect(all.completed).toBe(2);
  });

  it("only counts through today when nothing is checked off in the future", async () => {
    wellBehaved();
    const plan = makePlan();
    plan.weeks[0].days[0].tasks[0].completed = true;
    const wk1 = (await summarize(plan, { scope: "week", weekNumber: 1 })).json;
    expect(wk1.total).toBe(4); // today is Wed Oct 14: Mon + Wed, not Friday
  });

  it("gives a friendly empty summary (not an error) for a week that has not started", async () => {
    wellBehaved();
    const { res, json } = await summarize(makePlan(), { scope: "week", weekNumber: 2 });
    expect(res.status).toBe(200);
    expect(json.total).toBe(0);
    expect(json.groups).toEqual([]);
    expect(create).not.toHaveBeenCalled();
  });

  it("labels the since-start summary and returns version 3", async () => {
    wellBehaved();
    const { json } = await summarize(makePlan(), { scope: "to-date" });
    expect(json.v).toBe(3);
    expect(json.scope).toBe("to-date");
    expect(json.label).toBe("Since 10-12-2026");
  });
});

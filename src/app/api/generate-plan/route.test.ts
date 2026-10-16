import { beforeEach, describe, expect, it, vi } from "vitest";
import { create, reply, systemOf, userOf } from "@/test/anthropic-mock";
import type { ProgramPlan } from "@/lib/fitness";

// The factory runs before static imports are initialised, so it loads the shared fake lazily.
vi.mock("@anthropic-ai/sdk", async () => (await import("@/test/anthropic-mock")).anthropicModule());

import { POST } from "./route";

const body = (over: Record<string, unknown> = {}) => ({
  fitnessGoal: "Build leg strength",
  programLengthWeeks: 3,
  startDate: "2026-10-12",
  currentWeight: "175 lbs",
  distanceUnit: "miles",
  preferredDays: ["Monday", "Wednesday", "Friday"],
  timePerDay: { Monday: "45 minutes", Wednesday: "30 minutes", Friday: "60 minutes" },
  ...over,
});

const call = (b: unknown, raw = false) =>
  POST(new Request("http://test/api/generate-plan", { method: "POST", headers: { "Content-Type": "application/json" }, body: raw ? (b as string) : JSON.stringify(b) }));

const taskJson = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ id: "x", name: `Task ${i + 1}`, repsOrDuration: "3 x 10", estimatedCalories: "50", completed: true }));

type Args = { system?: unknown; messages: { content: unknown }[] };

/** The day names the week prompt asks for ("Monday (2026-10-12) | time available: ..."). */
const requestedDays = (args: Args) => [...userOf(args).matchAll(/^(\w+day) \(/gm)].map((m) => m[1]);
const weekOf = (args: Args) => Number(/Write week (\d+) of/.exec(userOf(args))![1]);
const isHeader = (args: Args) => systemOf(args).includes('"programTitle"');

/** Default fake: a title/summary for the header call and a full, valid week for every week call. */
const wellBehaved = (headerSummary = "easy runs and leg strength") =>
  create.mockImplementation(async (args: Args) => {
    if (isHeader(args)) return reply({ programTitle: "Stronger Legs", summary: headerSummary });
    return reply({ days: requestedDays(args).map((dayName) => ({ dayName, focus: `${dayName} focus`, tasks: taskJson(3) })) });
  });

beforeEach(() => {
  create.mockReset();
  process.env.ANTHROPIC_API_KEY = "sk-test";
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("POST /api/generate-plan: request handling", () => {
  it("returns 500 with a clear message when the API key is missing or still the placeholder", async () => {
    for (const key of [undefined, "", "your_key_here"]) {
      if (key === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = key;
      const res = await call(body());
      expect(res.status).toBe(500);
      expect((await res.json()).error).toMatch(/ANTHROPIC_API_KEY is not set/);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it("points visitors of a deployed demo (no key) to the example plan instead of to setup steps", async () => {
    vi.stubEnv("NODE_ENV", "production");
    delete process.env.ANTHROPIC_API_KEY;
    const res = await call(body());
    vi.unstubAllEnvs();
    expect(res.status).toBe(500);
    const { error } = await res.json();
    expect(error).toMatch(/example plan/i);
    expect(error).not.toMatch(/\.env\.local|ANTHROPIC_API_KEY/);
  });

  it("returns 400 for a body that is not JSON", async () => {
    const res = await call("{nope", true);
    expect(res.status).toBe(400);
  });

  it("returns 400 with details for an invalid intake, without calling the model", async () => {
    const res = await call(body({ fitnessGoal: "", preferredDays: [], timePerDay: {} }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid intake data.");
    expect(json.details.join(" ")).toMatch(/Fitness goal is required/);
    expect(json.details.join(" ")).toMatch(/Select at least one preferred day/);
    expect(create).not.toHaveBeenCalled();
  });
});

describe("POST /api/generate-plan: parsing the model's response", () => {
  it("assembles a plan with one entry per week and the chosen days in order", async () => {
    wellBehaved();
    const res = await call(body());
    expect(res.status).toBe(200);
    const plan = (await res.json()) as ProgramPlan;

    expect(plan.programTitle).toBe("Stronger Legs");
    expect(plan.weeks.map((w) => w.weekNumber)).toEqual([1, 2, 3]);
    for (const w of plan.weeks) expect(w.days.map((d) => d.dayName)).toEqual(["Monday", "Wednesday", "Friday"]);
    expect(create).toHaveBeenCalledTimes(1 + 3); // header + one request per week
  });

  it("gives every task a unique id and completed=false regardless of what the model returned", async () => {
    wellBehaved();
    const plan = (await (await call(body())).json()) as ProgramPlan;
    const tasks = plan.weeks.flatMap((w) => w.days.flatMap((d) => d.tasks));
    expect(tasks).toHaveLength(3 * 3 * 3);
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length);
    expect(plan.weeks[1].days[2].tasks[1].id).toBe("w2-d3-t2");
    expect(tasks.every((t) => t.completed === false)).toBe(true);
  });

  it("states the frequency from the chosen days: 'N days a week: ...'", async () => {
    wellBehaved("easy runs and leg strength");
    const plan = (await (await call(body())).json()) as ProgramPlan;
    expect(plan.summary).toBe("3 days a week: easy runs and leg strength.");

    wellBehaved("Three sessions a week: easy runs.");
    const one = (await (await call(body({ preferredDays: ["Saturday"], timePerDay: { Saturday: "90 minutes" } }))).json()) as ProgramPlan;
    expect(one.summary).toBe("1 day a week: easy runs.");
  });

  it("clamps the program length to 12 weeks", async () => {
    wellBehaved();
    const plan = (await (await call(body({ programLengthWeeks: 99 }))).json()) as ProgramPlan;
    expect(plan.weeks).toHaveLength(12);
  });

  it("accepts abbreviated day names and caps tasks at five per day", async () => {
    create.mockImplementation(async (args: Args) => {
      if (isHeader(args)) return reply({ programTitle: "T", summary: "s" });
      return reply({ days: requestedDays(args).map((d) => ({ dayName: d.slice(0, 3), focus: "f", tasks: taskJson(8) })) });
    });
    const plan = (await (await call(body({ programLengthWeeks: 1 }))).json()) as ProgramPlan;
    expect(plan.weeks[0].days.map((d) => d.dayName)).toEqual(["Monday", "Wednesday", "Friday"]);
    expect(plan.weeks[0].days[0].tasks).toHaveLength(5);
  });

  it("uses Monday-Sunday weeks: a mid-week start gives a shorter first week", async () => {
    wellBehaved();
    // Thursday Oct 15 start, 2 weeks, Mon/Wed/Fri: week 1 has only Friday; week 2 has all three.
    const plan = (await (await call(body({ startDate: "2026-10-15", programLengthWeeks: 2 }))).json()) as ProgramPlan;
    expect(plan.weeks.map((w) => w.days.map((d) => d.dayName))).toEqual([["Friday"], ["Monday", "Wednesday", "Friday"]]);
    expect(plan.summary).toMatch(/^3 days a week: /);
  });

  it("skips the model for a first week that has none of the chosen days", async () => {
    wellBehaved();
    // Sunday start: week 1 (Mon-Sun) has no Mon/Wed/Fri on or after the start date.
    const plan = (await (await call(body({ startDate: "2026-10-18", programLengthWeeks: 2 }))).json()) as ProgramPlan;
    expect(plan.weeks[0].days).toEqual([]);
    expect(plan.weeks[1].days).toHaveLength(3);
    expect(create).toHaveBeenCalledTimes(1 + 1); // header + week 2 only
  });

  it("tells the model the distance unit and weight", async () => {
    wellBehaved();
    await call(body({ programLengthWeeks: 1, distanceUnit: "km", currentWeight: "80 kg" }));
    const weekPrompt = create.mock.calls.map(([a]) => a as Args).find((a) => !isHeader(a))!;
    expect(userOf(weekPrompt)).toMatch(/Distance unit: km/);
    expect(userOf(weekPrompt)).toMatch(/Current weight: 80 kg/);
  });
});

describe("POST /api/generate-plan: recovering from bad model output", () => {
  it("retries a week that comes back with a missing day, and then succeeds", async () => {
    let week2Attempts = 0;
    create.mockImplementation(async (args: Args) => {
      if (isHeader(args)) return reply({ programTitle: "T", summary: "s" });
      const days = requestedDays(args);
      if (weekOf(args) === 2 && ++week2Attempts === 1) {
        return reply({ days: [{ dayName: days[0], focus: "f", tasks: taskJson(3) }] }); // only Monday
      }
      return reply({ days: days.map((dayName) => ({ dayName, focus: "f", tasks: taskJson(3) })) });
    });
    const res = await call(body());
    expect(res.status).toBe(200);
    expect(week2Attempts).toBe(2);
    expect(((await res.json()) as ProgramPlan).weeks[1].days).toHaveLength(3);
  });

  it("gives up after three malformed attempts with a readable error", async () => {
    create.mockImplementation(async (args: Args) => {
      if (isHeader(args)) return reply({ programTitle: "T", summary: "s" });
      return reply({ days: [] });
    });
    const res = await call(body({ programLengthWeeks: 1 }));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatch(/Week 1 could not be generated after 3 tries/);
    expect(create.mock.calls.filter(([a]) => !isHeader(a as Args))).toHaveLength(3);
  });

  it("copes with stray prose or code fences around the JSON", async () => {
    create.mockImplementation(async (args: Args) => {
      if (isHeader(args)) return reply("```json\n" + JSON.stringify({ programTitle: "T", summary: "s" }) + "\n```");
      const days = requestedDays(args).map((dayName) => ({ dayName, focus: "f", tasks: taskJson(2) }));
      return reply(`Here you go: ${JSON.stringify({ days })} Enjoy!`);
    });
    const res = await call(body({ programLengthWeeks: 1 }));
    expect(res.status).toBe(200);
  });

  it("reports a refusal and API errors as 500s with a useful message", async () => {
    create.mockImplementation(async (args: Args) => (isHeader(args) ? reply({ programTitle: "T", summary: "s" }) : { stop_reason: "refusal", content: [] }));
    const refused = await call(body({ programLengthWeeks: 1 }));
    expect(refused.status).toBe(500);
    expect((await refused.json()).error).toMatch(/declined/);

    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    // The test double's error classes take just a message (the real SDK's take more), hence the cast.
    const apiError = (Cls: unknown, message: string, status: number) => Object.assign(new (Cls as new (m: string) => Error)(message), { status });
    create.mockReset();
    create.mockRejectedValue(apiError(Anthropic.AuthenticationError, "bad key", 401));
    const unauthorized = await call(body({ programLengthWeeks: 1 }));
    expect(unauthorized.status).toBe(500);
    expect((await unauthorized.json()).error).toMatch(/rejected the API key/);

    create.mockReset();
    create.mockRejectedValue(apiError(Anthropic.APIError, "Your credit balance is too low to access the Anthropic API.", 400));
    const broke = await call(body({ programLengthWeeks: 1 }));
    expect((await broke.json()).error).toMatch(/out of credits/);
  });
});

// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import type { ActivePlan } from "@/lib/fitness";
import { STORAGE_KEY, makeActive } from "@/test/fixtures";

const seed = (active: ActivePlan = makeActive()) => localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
const stored = () => JSON.parse(localStorage.getItem(STORAGE_KEY)!) as ActivePlan;

/** Open on Monday Oct 12, the first training day of week 1. */
const openDashboard = async (active?: ActivePlan) => {
  seed(active);
  const user = userEvent.setup({ delay: null });
  const view = render(<Home />);
  await screen.findByText("Stronger Legs");
  return Object.assign(user, { view });
};

const progress = (label: string) => screen.getByRole("progressbar", { name: label });
const box = (name: string) => screen.getByRole("checkbox", { name: `Mark complete: ${name}` });

beforeEach(() => {
  // Fake only the clock, so timers keep working. Mon Oct 12, 2026: the first day of the plan.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-12T09:00:00"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("dashboard: ticking tasks updates progress", () => {
  it("shows the saved plan with the week and program progress at zero", async () => {
    await openDashboard();
    expect(screen.getByText("Week 1 of 2")).toBeInTheDocument();
    expect(screen.getByText(/0\/6 - 0%/)).toBeInTheDocument();
    expect(screen.getByText(/0\/12 - 0%/)).toBeInTheDocument();
    expect(progress("Week progress")).toHaveAttribute("aria-valuenow", "0");
  });

  it("ticking a task updates the day count, both progress bars and the saved plan", async () => {
    const user = await openDashboard();
    await user.click(box("Squat 1-1"));

    expect(box("Squat 1-1")).toBeChecked();
    expect(screen.getByText("1/2 done")).toBeInTheDocument();
    expect(screen.getByText(/1\/6 - 17%/)).toBeInTheDocument();
    expect(screen.getByText(/1\/12 - 8%/)).toBeInTheDocument();
    expect(progress("Week progress")).toHaveAttribute("aria-valuenow", "17");
    expect(progress("Program progress")).toHaveAttribute("aria-valuenow", "8");

    const saved = stored();
    expect(saved.plan.weeks[0].days[0].tasks[0].completed).toBe(true);
    expect(saved.plan.weeks[0].days[0].tasks[1].completed).toBe(false);
  });

  it("unticking reverses it", async () => {
    const user = await openDashboard();
    await user.click(box("Squat 1-1"));
    await user.click(box("Squat 1-1"));
    expect(box("Squat 1-1")).not.toBeChecked();
    expect(screen.getByText(/0\/6 - 0%/)).toBeInTheDocument();
    expect(stored().plan.weeks[0].days[0].tasks[0].completed).toBe(false);
  });

  it("ticking every task in a day shows the day done and 100% for that day's share", async () => {
    const user = await openDashboard();
    await user.click(box("Squat 1-1"));
    await user.click(box("Run 1-1"));
    expect(screen.getByText("2/2 done")).toBeInTheDocument();
    expect(screen.getByText(/2\/6 - 33%/)).toBeInTheDocument();
  });

  it("restores ticks after a reload", async () => {
    const user = await openDashboard();
    await user.click(box("Run 1-1"));
    user.view.unmount(); // close the page, then open it again: state comes back from storage
    render(<Home />);
    await waitFor(() => expect(box("Run 1-1")).toBeChecked());
    expect(screen.getByText(/1\/6 - 17%/)).toBeInTheDocument();
  });

  it("keeps progress per week: week 2 starts at zero and week navigation stops at the ends", async () => {
    const user = await openDashboard();
    await user.click(box("Squat 1-1"));

    const prev = screen.getByRole("button", { name: "Previous week" });
    const next = screen.getByRole("button", { name: "Next week" });
    expect(prev).toBeDisabled();
    await user.click(next);
    expect(screen.getByText("Week 2 of 2")).toBeInTheDocument();
    expect(next).toBeDisabled();
    expect(screen.getByText(/0\/6 - 0%/)).toBeInTheDocument(); // week 2
    expect(screen.getByText(/1\/12 - 8%/)).toBeInTheDocument(); // whole program still includes week 1
    await user.click(prev);
    expect(screen.getByText(/1\/6 - 17%/)).toBeInTheDocument();
  });

  it("selecting another day shows that day's tasks", async () => {
    const user = await openDashboard();
    await user.click(screen.getByRole("button", { name: /Wed/ }));
    expect(screen.getByText("Wednesday, October 14")).toBeInTheDocument();
    expect(box("Squat 1-2")).toBeInTheDocument();
  });
});

describe("dashboard: editing tasks", () => {
  it("deleting a task removes it and lowers the totals", async () => {
    const user = await openDashboard();
    await user.click(screen.getByRole("button", { name: "Delete task: Squat 1-1" }));
    expect(screen.queryByRole("checkbox", { name: "Mark complete: Squat 1-1" })).not.toBeInTheDocument();
    expect(screen.getByText(/0\/5 - 0%/)).toBeInTheDocument();
    expect(stored().plan.weeks[0].days[0].tasks).toHaveLength(1);
  });

  it("adding a task adds an unticked row that counts toward the totals", async () => {
    const user = await openDashboard();
    await user.click(screen.getByRole("button", { name: /Add task/ }));
    const names = screen.getAllByLabelText("Task name");
    expect(names).toHaveLength(3);
    await user.type(names[2], "run 2 miles");
    expect(stored().plan.weeks[0].days[0].tasks[2].name).toBe("run 2 miles");
    expect(screen.getByText(/0\/7 - 0%/)).toBeInTheDocument();
  });

  it("editing a title saves it, and Enter finishes the edit", async () => {
    const user = await openDashboard();
    const name = screen.getAllByLabelText("Task name")[0] as HTMLTextAreaElement;
    await user.clear(name);
    await user.type(name, "Hill repeats{Enter}");
    expect(name).not.toHaveFocus();
    expect(name.value).toBe("Hill repeats");
    expect(stored().plan.weeks[0].days[0].tasks[0].name).toBe("Hill repeats");
  });

  it("editing the description with Enter never inserts a line break", async () => {
    const user = await openDashboard();
    const reps = screen.getAllByLabelText("Reps or duration")[0] as HTMLTextAreaElement;
    await user.clear(reps);
    await user.type(reps, "5 miles{Enter}");
    expect(reps.value).toBe("5 miles");
  });
});

describe("dashboard: starting over", () => {
  it("asks first; keeping the plan leaves everything in place", async () => {
    const user = await openDashboard();
    await user.click(screen.getByRole("button", { name: /New plan/ }));
    const dialog = screen.getByRole("dialog", { hidden: true });
    expect(within(dialog).getByText("Start a new plan?")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Keep my plan", hidden: true }));
    expect(screen.getByText("Stronger Legs")).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
  });

  it("confirming clears the saved plan and shows the intake form", async () => {
    const user = await openDashboard();
    await user.click(screen.getByRole("button", { name: /New plan/ }));
    await user.click(within(screen.getByRole("dialog", { hidden: true })).getByRole("button", { name: "Start new plan", hidden: true }));
    expect(await screen.findByLabelText("Fitness Goal")).toBeInTheDocument();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });
});

describe("dashboard: Monday-to-Sunday weeks", () => {
  const partial = () => {
    // Thursday Oct 15 start, Mon/Wed/Fri: week 1 (Mon Oct 12 - Sun Oct 18) only has Friday to train.
    const active = makeActive({ intake: { ...makeActive().intake, startDate: "2026-10-15", weekAnchor: "monday" } });
    active.plan.weeks[0].days = [active.plan.weeks[0].days[2]]; // Friday only
    return active;
  };

  it("always shows Mon to Sun for the week and greys out days before the start date", async () => {
    vi.setSystemTime(new Date("2026-10-16T09:00:00")); // Friday of week 1
    const user = await openDashboard(partial());
    expect(screen.getByText("Oct 12 to Oct 18")).toBeInTheDocument();
    const strip = screen.getAllByRole("button", { name: /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)/ }).slice(0, 7);
    expect(strip.map((b) => b.textContent!.slice(0, 3))).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
    expect(screen.getByRole("button", { name: /Mon/ })).toHaveAttribute("title", "Before your start date");
    expect(screen.getByRole("button", { name: /Thu/ })).not.toHaveAttribute("title");

    await user.click(screen.getByRole("button", { name: /Tue/ }));
    expect(screen.getByText(/before your start date, so there is nothing to do yet/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add your own task/ })).not.toBeInTheDocument();
  });

  it("opens on today's day when today is inside the program", async () => {
    vi.setSystemTime(new Date("2026-10-16T09:00:00"));
    await openDashboard(partial());
    expect(screen.getByText("Friday, October 16")).toBeInTheDocument();
  });

  it("opens on the first week when the program has not started yet", async () => {
    vi.setSystemTime(new Date("2026-10-01T09:00:00"));
    await openDashboard(partial());
    expect(screen.getByText("Week 1 of 2")).toBeInTheDocument();
    expect(screen.getByText("Friday, October 16")).toBeInTheDocument(); // the first training day
  });

  it("keeps a plan saved with the old layout on its original dates", async () => {
    // Saved before this change: Thursday start, weeks ran Thu..Wed, no weekAnchor field.
    const legacy = makeActive({ intake: { ...makeActive().intake, startDate: "2026-10-15" } });
    vi.setSystemTime(new Date("2026-10-15T09:00:00"));
    await openDashboard(legacy);
    expect(screen.getByText("Oct 15 to Oct 21")).toBeInTheDocument(); // Thu..Wed, as before
    expect(stored().intake.weekAnchor).toBe("start");
  });

  it("does not touch a saved plan that starts on a Monday", async () => {
    await openDashboard();
    expect(screen.getByText("Oct 12 to Oct 18")).toBeInTheDocument();
    expect(stored().intake.weekAnchor).toBeUndefined();
  });
});

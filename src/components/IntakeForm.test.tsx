// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IntakeForm } from "@/components/IntakeForm";
import type { Intake } from "@/lib/fitness";

const setup = () => {
  const onSubmit = vi.fn<(i: Intake) => void>();
  // delay: null skips the artificial pause between keystrokes, which makes these tests several times faster.
  const user = userEvent.setup({ delay: null });
  render(<IntakeForm loading={false} onSubmit={onSubmit} />);
  return { onSubmit, user };
};

const goal = () => screen.getByLabelText("Fitness Goal");
const submit = () => screen.getByRole("button", { name: /generate fitness plan/i });
// Day toggles are checkboxes wrapped in a label whose text is the 3-letter day.
const day = (abbr: string) => screen.getByRole("checkbox", { name: abbr });
const duration = (name: string) => screen.getByLabelText(name) as HTMLSelectElement;

beforeEach(() => {
  vi.useRealTimers();
});

describe("IntakeForm validation", () => {
  it("does not submit and lists what is missing when nothing is filled in", async () => {
    const { onSubmit, user } = setup();
    await user.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    const banner = screen.getByRole("alert");
    expect(within(banner).getByText("Fitness Goal is required.")).toBeInTheDocument();
    expect(within(banner).getByText("Select at least one Preferred Day.")).toBeInTheDocument();
    expect(goal()).toHaveAttribute("aria-invalid", "true");
    expect(goal().className).toMatch(/border-red-500/);
  });

  it("requires a duration for each selected day (no silent default)", async () => {
    const { onSubmit, user } = setup();
    await user.type(goal(), "Run a 10k");
    await user.click(day("Mon"));
    await user.click(day("Wed"));
    await user.click(submit());

    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText("Set a duration for: Monday, Wednesday.")).toBeInTheDocument();
    expect(duration("Monday").className).toMatch(/border-red-500/);
    expect(duration("Monday").value).toBe("");
  });

  it("clears a field's red highlight once it is fixed", async () => {
    const { user } = setup();
    await user.click(submit());
    expect(goal().className).toMatch(/border-red-500/);
    await user.type(goal(), "x");
    expect(goal().className).not.toMatch(/border-red-500/);
  });

  it("marks optional fields with (Optional) and required ones without it", () => {
    setup();
    for (const label of ["Starting Point", "Current Weight", "Special Considerations"]) {
      expect(screen.getByText(label, { exact: false }).parentElement).toHaveTextContent("(Optional)");
    }
    expect(screen.getByText("Fitness Goal").parentElement).not.toHaveTextContent("(Optional)");
  });

  it("rejects an unrealistic weight but allows leaving it blank", async () => {
    const { onSubmit, user } = setup();
    await user.type(goal(), "Get fit");
    await user.click(day("Mon"));
    await user.selectOptions(duration("Monday"), "30 minutes");

    await user.type(screen.getByLabelText(/Current Weight/), "5");
    await user.click(submit());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByText(/Current Weight must be a realistic number in lbs/)).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Current Weight/));
    await user.click(submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit.mock.calls[0][0].currentWeight).toBeUndefined();
  });

  it("offers program length as a 1-12 week dropdown, defaulting to 8", async () => {
    const { user } = setup();
    const weeks = screen.getByLabelText("Program Length") as HTMLSelectElement;
    expect(weeks.tagName).toBe("SELECT");
    const options = within(weeks).getAllByRole("option").map((o) => o.textContent);
    expect(options).toHaveLength(12);
    expect(options[0]).toBe("1 week"); // singular
    expect(options[1]).toBe("2 weeks");
    expect(options.at(-1)).toBe("12 weeks");
    expect(weeks.value).toBe("8");

    await user.selectOptions(weeks, "12");
    expect(weeks.value).toBe("12");
  });

  it("submits the chosen program length", async () => {
    const { onSubmit, user } = setup();
    await user.type(goal(), "x");
    await user.click(day("Mon"));
    await user.selectOptions(duration("Monday"), "30 minutes");
    await user.selectOptions(screen.getByLabelText("Program Length"), "3");
    await user.click(submit());
    expect(onSubmit.mock.calls[0][0].programLengthWeeks).toBe(3);
  });
});

describe("IntakeForm submission", () => {
  it("submits the full payload (weight with its unit, durations, distance unit)", async () => {
    const { onSubmit, user } = setup();
    await user.type(goal(), "  Build leg strength  ");
    await user.type(screen.getByLabelText(/Starting Point/), "Beginner");
    await user.click(screen.getByRole("button", { name: "Strength" }));
    await user.click(screen.getByRole("button", { name: "Running" }));
    await user.click(day("Wed"));
    await user.click(day("Mon")); // clicked out of order on purpose
    await user.selectOptions(duration("Monday"), "60 minutes");
    await user.selectOptions(duration("Wednesday"), "30 minutes");
    await user.type(screen.getByLabelText(/Current Weight/), "175");
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const sent = onSubmit.mock.calls[0][0];
    expect(sent).toMatchObject({
      fitnessGoal: "Build leg strength",
      startingPoint: "Beginner",
      preferredActivities: ["Strength", "Running"],
      programLengthWeeks: 8,
      currentWeight: "175 lbs",
      distanceUnit: "miles",
      preferredDays: ["Monday", "Wednesday"],
      timePerDay: { Monday: "60 minutes", Wednesday: "30 minutes" },
    });
    expect(sent.startDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sent.specialConsiderations).toBeUndefined();
  });

  it("offers durations up to 120 minutes", () => {
    setup();
    // The duration selects appear once a day is chosen.
    return userEvent.click(day("Mon")).then(() => {
      const options = within(duration("Monday")).getAllByRole("option").map((o) => o.textContent);
      expect(options).toContain("90 minutes");
      expect(options).toContain("105 minutes");
      expect(options.at(-1)).toBe("120 minutes");
    });
  });
});

describe("weight and distance units", () => {
  it("defaults to lbs and miles", () => {
    setup();
    expect((screen.getByLabelText("Weight unit") as HTMLSelectElement).value).toBe("lbs");
    expect((screen.getByLabelText("Distance Units") as HTMLSelectElement).value).toBe("miles");
  });

  it("switches distance to km when kg is chosen, and back again", async () => {
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Weight unit"), "kg");
    expect((screen.getByLabelText("Distance Units") as HTMLSelectElement).value).toBe("km");
    await user.selectOptions(screen.getByLabelText("Weight unit"), "lbs");
    expect((screen.getByLabelText("Distance Units") as HTMLSelectElement).value).toBe("miles");
  });

  it("stops following the weight unit once the user picks a distance unit", async () => {
    const { onSubmit, user } = setup();
    await user.selectOptions(screen.getByLabelText("Distance Units"), "km");
    await user.selectOptions(screen.getByLabelText("Weight unit"), "kg");
    await user.selectOptions(screen.getByLabelText("Weight unit"), "lbs");
    expect((screen.getByLabelText("Distance Units") as HTMLSelectElement).value).toBe("km");

    await user.type(goal(), "x");
    await user.click(day("Mon"));
    await user.selectOptions(duration("Monday"), "30 minutes");
    await user.type(screen.getByLabelText(/Current Weight/), "80");
    await user.click(submit());
    expect(onSubmit.mock.calls[0][0]).toMatchObject({ currentWeight: "80 lbs", distanceUnit: "km" });
  });
});

describe("carrying a duration across days", () => {
  const values = () => ({
    Mon: (screen.queryByLabelText("Monday") as HTMLSelectElement | null)?.value,
    Tue: (screen.queryByLabelText("Tuesday") as HTMLSelectElement | null)?.value,
    Wed: (screen.queryByLabelText("Wednesday") as HTMLSelectElement | null)?.value,
    Thu: (screen.queryByLabelText("Thursday") as HTMLSelectElement | null)?.value,
  });

  it("fills other blank selected days when a time is first set, never overwriting set ones", async () => {
    const { user } = setup();
    await user.click(day("Mon"));
    await user.click(day("Tue"));
    await user.click(day("Wed"));
    expect(values()).toMatchObject({ Mon: "", Tue: "", Wed: "" });

    await user.selectOptions(duration("Monday"), "60 minutes");
    expect(values()).toMatchObject({ Mon: "60 minutes", Tue: "60 minutes", Wed: "60 minutes" });

    await user.selectOptions(duration("Tuesday"), "30 minutes");
    expect(values()).toMatchObject({ Mon: "60 minutes", Tue: "30 minutes", Wed: "60 minutes" });

    await user.selectOptions(duration("Wednesday"), ""); // back to blank
    await user.selectOptions(duration("Monday"), "45 minutes");
    expect(values()).toMatchObject({ Mon: "45 minutes", Tue: "30 minutes", Wed: "45 minutes" });
  });

  it("gives days ticked later the most recently chosen time", async () => {
    const { user } = setup();
    await user.click(day("Mon"));
    await user.selectOptions(duration("Monday"), "90 minutes");
    await user.click(day("Thu"));
    expect(values()).toMatchObject({ Mon: "90 minutes", Thu: "90 minutes" });
  });

  it("clears the 'set a duration' error on days that get filled", async () => {
    const { user } = setup();
    await user.type(goal(), "x");
    await user.click(day("Mon"));
    await user.click(day("Tue"));
    await user.click(submit());
    expect(duration("Monday").className).toMatch(/border-red-500/);
    await user.selectOptions(duration("Monday"), "30 minutes");
    expect(duration("Tuesday").className).not.toMatch(/border-red-500/);
  });
});

describe("after a failed submit", () => {
  let scrolled: Element[];
  beforeEach(() => {
    scrolled = [];
    Element.prototype.scrollIntoView = function (this: Element) {
      scrolled.push(this);
    };
  });

  it("scrolls to and focuses the first missing field, with a short message under it", async () => {
    const { user } = setup();
    await user.click(submit());

    expect(goal()).toHaveFocus();
    expect(scrolled.at(-1)).toBe(goal());
    expect(screen.getByText("Tell us what you want to achieve.")).toBeInTheDocument();
    expect(goal()).toHaveAttribute("aria-describedby", "goal-error");
    expect(screen.getByText("Pick at least one day.")).toBeInTheDocument();
  });

  it("moves on to the next problem once the first is fixed (form order: goal, then days, then durations)", async () => {
    const { user } = setup();
    await user.click(submit());
    await user.type(goal(), "Run a 10k");
    await user.click(submit());
    expect(day("Mon")).toHaveFocus(); // days are focused via their first checkbox
    expect(scrolled.at(-1)).toBe(document.getElementById("days-group"));

    await user.click(day("Wed"));
    await user.click(submit());
    expect(duration("Wednesday")).toHaveFocus();
    expect(screen.getByText("Choose a duration.")).toBeInTheDocument();
  });

  it("jumps to the first of several missing durations, and clears the message when it is fixed", async () => {
    const { user } = setup();
    await user.type(goal(), "x");
    await user.click(day("Mon"));
    await user.click(day("Fri"));
    await user.click(submit());
    expect(duration("Monday")).toHaveFocus();
    expect(screen.getAllByText("Choose a duration.")).toHaveLength(2);
    await user.selectOptions(duration("Monday"), "30 minutes"); // also fills Friday
    expect(screen.queryByText("Choose a duration.")).not.toBeInTheDocument();
  });

  it("does not scroll when everything is valid", async () => {
    const { onSubmit, user } = setup();
    await user.type(goal(), "x");
    await user.click(day("Mon"));
    await user.selectOptions(duration("Monday"), "30 minutes");
    await user.click(submit());
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(scrolled).toHaveLength(0);
  });
});

describe("example plan link", () => {
  it("shows only when the page provides it, and calls it without submitting the form", async () => {
    const user = userEvent.setup({ delay: null });
    const onExample = vi.fn();
    const onSubmit = vi.fn();
    const { unmount } = render(<IntakeForm loading={false} onSubmit={onSubmit} onExample={onExample} />);
    await user.click(screen.getByRole("button", { name: /see an example plan/i }));
    expect(onExample).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); // no validation banner either
    unmount();

    render(<IntakeForm loading={false} onSubmit={onSubmit} />);
    expect(screen.queryByRole("button", { name: /see an example plan/i })).not.toBeInTheDocument();
  });
});

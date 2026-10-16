"use client";

import { useEffect, useState } from "react";
import { AlertCircle, CalendarDays, Loader2, Plus, Sparkles, Target, User } from "lucide-react";
import { ACTIVITY_OPTIONS, DAYS, TIME_OPTIONS, WEEKS, clamp, isValidDateString, type DistanceUnit, type Intake } from "@/lib/fitness";
import { cn } from "@/lib/utils";

interface Props {
  loading: boolean;
  onSubmit: (intake: Intake) => void;
  /** Opens a ready-made example plan (no AI call). */
  onExample?: () => void;
}

const Optional = () => <span className="text-xs text-slate-400 font-normal">(Optional)</span>;

const fieldCls = (invalid = false) =>
  cn(
    "w-full rounded-lg border bg-slate-950 px-3 py-2 text-slate-100 placeholder:text-slate-500 outline-none transition focus:ring-2 disabled:opacity-60",
    invalid ? "border-red-500 focus:ring-red-500/30" : "border-slate-700 focus:border-emerald-500 focus:ring-emerald-500/30",
  );
const labelCls = "mb-1.5 block text-sm font-medium text-slate-200";

const todayString = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** Short message shown directly under a field that failed validation. */
function FieldError({ id, text }: { id: string; text?: string }) {
  if (!text) return null;
  return (
    <p id={`${id}-error`} className="mt-1 text-xs text-red-400">
      {text}
    </p>
  );
}

function Chunk({ icon: Icon, title, children }: { icon: typeof Target; title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <legend className="sr-only">{title}</legend>
      <h2 className="flex items-center gap-2 text-base font-semibold text-white">
        <Icon className="h-5 w-5 text-emerald-400" /> {title}
      </h2>
      {children}
    </fieldset>
  );
}

export function IntakeForm({ loading, onSubmit, onExample }: Props) {
  const [goal, setGoal] = useState("");
  const [startingPoint, setStartingPoint] = useState("");
  const [activities, setActivities] = useState<string[]>([]);
  const [customActivity, setCustomActivity] = useState("");
  const [weeks, setWeeks] = useState("8");
  const [startDate, setStartDate] = useState("");
  const [weight, setWeight] = useState("");
  const [weightUnit, setWeightUnit] = useState<"lbs" | "kg">("lbs");
  // Distance unit follows the weight unit (kg -> km, lbs -> miles) until the user picks one themselves.
  const [distanceUnit, setDistanceUnit] = useState<DistanceUnit>("miles");
  const [distanceTouched, setDistanceTouched] = useState(false);
  const [days, setDays] = useState<string[]>([]);
  const [times, setTimes] = useState<Record<string, string>>({});
  // Most recently chosen duration: newly selected days start with it (still editable per day).
  const [lastTime, setLastTime] = useState("");
  const [considerations, setConsiderations] = useState("");
  // Field keys that failed validation on the last submit (drives red borders) + banner messages.
  const [invalid, setInvalid] = useState<Set<string>>(new Set());
  const [messages, setMessages] = useState<string[]>([]);
  // Short per-field messages shown right under the field, and a request to bring the first bad field into view.
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [focusRequest, setFocusRequest] = useState<{ id: string; n: number } | null>(null);

  // Default to today after mount: reading the clock during prerender is not allowed.
  useEffect(() => {
    setStartDate((cur) => cur || todayString());
  }, []);

  // After a failed submit, scroll the first missing field to the middle of the screen and put the cursor in it.
  useEffect(() => {
    if (!focusRequest) return;
    const el = document.getElementById(focusRequest.id);
    if (!el) return;
    const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const target = focusRequest.id === "day-Mon" ? (document.getElementById("days-group") ?? el) : el;
    target.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    el.focus({ preventScroll: true });
  }, [focusRequest]);

  const clear = (key: string) => {
    setErrors((cur) => {
      if (!(key in cur)) return cur;
      const { [key]: _gone, ...rest } = cur;
      void _gone;
      return rest;
    });
    setInvalid((cur) => {
      if (!cur.has(key)) return cur;
      const next = new Set(cur);
      next.delete(key);
      return next;
    });
  };

  const toggleActivity = (a: string) =>
    setActivities((cur) => (cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]));

  function addCustomActivity() {
    const v = customActivity.trim();
    if (v && !activities.some((a) => a.toLowerCase() === v.toLowerCase())) setActivities((cur) => [...cur, v]);
    setCustomActivity("");
  }

  function toggleDay(day: string) {
    clear("days");
    if (!days.includes(day) && lastTime && !times[day]) {
      setTimes((cur) => ({ ...cur, [day]: lastTime }));
      clear(`time-${day}`);
    }
    setDays((cur) => (cur.includes(day) ? cur.filter((d) => d !== day) : DAYS.filter((d) => d === day || cur.includes(d))));
  }

  function validate() {
    const bad: Record<string, string> = {}; // field key -> short message, in the order fields appear on the page
    const msgs: string[] = [];
    const w = parseFloat(weeks);

    if (!goal.trim()) {
      bad.goal = "Tell us what you want to achieve.";
      msgs.push("Fitness Goal is required.");
    }
    if (!Number.isFinite(w) || w < WEEKS.min || w > WEEKS.max) {
      bad.weeks = `Choose between ${WEEKS.min} and ${WEEKS.max} weeks.`;
      msgs.push(`Program Length must be between ${WEEKS.min} and ${WEEKS.max} weeks.`);
    }
    if (!isValidDateString(startDate)) {
      bad.startDate = "Pick a start date.";
      msgs.push("Start Date is required.");
    }
    if (days.length === 0) {
      bad.days = "Pick at least one day.";
      msgs.push("Select at least one Preferred Day.");
    } else {
      const missing = days.filter((d) => !times[d]);
      for (const d of missing) bad[`time-${d}`] = "Choose a duration.";
      if (missing.length) msgs.push(`Set a duration for: ${missing.join(", ")}.`);
    }
    if (weight.trim()) {
      const kg = weightUnit === "kg" ? parseFloat(weight) : parseFloat(weight) / 2.20462;
      if (!Number.isFinite(kg) || kg < 25 || kg > 400) {
        bad.weight = "Enter a realistic weight, or leave it blank.";
        msgs.push(`Current Weight must be a realistic number in ${weightUnit} (or leave it blank).`);
      }
    }
    setInvalid(new Set(Object.keys(bad)));
    setErrors(bad);
    setMessages(msgs);
    // Jump to the first bad field (days are focused via their first checkbox).
    const first = Object.keys(bad)[0];
    if (first) setFocusRequest({ id: first === "days" ? "day-Mon" : first === "startDate" ? "date" : first, n: Date.now() });
    return msgs.length === 0;
  }

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    if (loading || !validate()) return;
    const orUndef = (s: string) => (s.trim() ? s.trim() : undefined);
    onSubmit({
      fitnessGoal: goal.trim(),
      startingPoint: orUndef(startingPoint),
      preferredActivities: activities.length ? activities : undefined,
      programLengthWeeks: clamp(Math.round(parseFloat(weeks)), WEEKS.min, WEEKS.max),
      startDate,
      currentWeight: weight.trim() ? `${Math.round(parseFloat(weight) * 10) / 10} ${weightUnit}` : undefined,
      preferredDays: days,
      timePerDay: Object.fromEntries(days.map((d) => [d, times[d]])),
      specialConsiderations: orUndef(considerations),
      distanceUnit,
    });
  }

  const chip = (active: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-sm transition disabled:opacity-60",
      active ? "border-emerald-500 bg-emerald-500/15 text-emerald-300" : "border-slate-700 bg-slate-950 text-slate-300 hover:border-slate-500",
    );

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-5">
      {onExample && (
        <p className="text-sm text-slate-400">
          New here?{" "}
          <button type="button" onClick={onExample} disabled={loading}
            className="font-medium text-emerald-300 underline-offset-4 transition hover:underline disabled:opacity-50">
            See an example plan
          </button>
        </p>
      )}

      {messages.length > 0 && (
        <div role="alert" className="rounded-xl border border-red-500/50 bg-red-950/50 p-4 text-sm text-red-200">
          <p className="mb-1 flex items-center gap-2 font-medium">
            <AlertCircle className="h-4 w-4" /> Please fix the following before generating your plan:
          </p>
          <ul className="list-disc space-y-0.5 pl-9">
            {messages.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <Chunk icon={Target} title="Objective & Preferences">
        <div>
          <label htmlFor="goal" className={labelCls}>Fitness Goal</label>
          <input id="goal" className={fieldCls(invalid.has("goal"))} value={goal} disabled={loading} maxLength={500}
            aria-invalid={invalid.has("goal")} aria-describedby={errors.goal ? "goal-error" : undefined}
            placeholder="e.g., Build functional leg strength and improve 5k run pace"
            onChange={(e) => {
              setGoal(e.target.value);
              clear("goal");
            }} />
          <FieldError id="goal" text={errors.goal} />
        </div>
        <div>
          <label htmlFor="start" className={labelCls}>Starting Point <Optional /></label>
          <input id="start" className={fieldCls()} value={startingPoint} disabled={loading} maxLength={1000}
            placeholder="e.g., Desk job, walk a bit, haven't trained in 2 years"
            onChange={(e) => setStartingPoint(e.target.value)} />
        </div>
        <div>
          <span className={labelCls}>Preferred Activities <Optional /></span>
          <div className="flex flex-wrap gap-2">
            {[...ACTIVITY_OPTIONS, ...activities.filter((a) => !(ACTIVITY_OPTIONS as readonly string[]).includes(a))].map((a) => (
              <button key={a} type="button" disabled={loading} aria-pressed={activities.includes(a)}
                onClick={() => toggleActivity(a)} className={chip(activities.includes(a))}>
                {a}
              </button>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <input aria-label="Add another activity" className={fieldCls()} value={customActivity} disabled={loading} maxLength={40}
              placeholder="Add another..."
              onChange={(e) => setCustomActivity(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCustomActivity();
                }
              }} />
            <button type="button" onClick={addCustomActivity} disabled={loading}
              className="inline-flex items-center gap-1 rounded-lg border border-slate-700 px-3 text-sm text-slate-200 hover:bg-slate-800">
              <Plus className="h-4 w-4" /> Add
            </button>
          </div>
        </div>
      </Chunk>

      <Chunk icon={CalendarDays} title="Schedule">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="weeks" className={labelCls}>Program Length</label>
            <select id="weeks" className={fieldCls(invalid.has("weeks"))} value={weeks} disabled={loading}
              onChange={(e) => {
                setWeeks(e.target.value);
                clear("weeks");
              }}>
              {Array.from({ length: WEEKS.max - WEEKS.min + 1 }, (_, i) => WEEKS.min + i).map((n) => (
                <option key={n} value={n}>{n} {n === 1 ? "week" : "weeks"}</option>
              ))}
            </select>
            <FieldError id="weeks" text={errors.weeks} />
          </div>
          <div>
            <label htmlFor="date" className={labelCls}>Start Date</label>
            <input id="date" type="date" className={cn(fieldCls(invalid.has("startDate")), "[color-scheme:dark]")} value={startDate} disabled={loading}
              onChange={(e) => {
                setStartDate(e.target.value);
                clear("startDate");
              }} />
            <FieldError id="date" text={errors.startDate} />
            <p className="mt-1 text-xs text-slate-500">Weeks run Monday to Sunday, so a mid-week start has a shorter first week.</p>
          </div>
        </div>

        <div>
          <span className={labelCls}>Preferred Days</span>
          <div id="days-group" role="group" aria-label="Preferred days"
            className={cn("flex flex-wrap gap-2 rounded-lg border p-2", invalid.has("days") ? "border-red-500" : "border-transparent")}>
            {DAYS.map((d) => (
              <label key={d} className="cursor-pointer">
                <input id={`day-${d.slice(0, 3)}`} type="checkbox" className="peer sr-only" checked={days.includes(d)} disabled={loading} onChange={() => toggleDay(d)} />
                <span className="inline-block rounded-full border border-slate-700 bg-slate-950 px-3 py-1 text-sm text-slate-300 transition hover:border-slate-500 peer-checked:border-emerald-500 peer-checked:bg-emerald-500/15 peer-checked:text-emerald-300 peer-focus-visible:ring-2 peer-focus-visible:ring-emerald-500/40">
                  {d.slice(0, 3)}
                </span>
              </label>
            ))}
          </div>
          <FieldError id="days" text={errors.days} />

          {days.length > 0 && (
            <div className="mt-3 grid gap-2 rounded-xl bg-slate-950/60 p-3 sm:grid-cols-2">
              {days.map((d) => (
                <div key={d}>
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor={`time-${d}`} className="text-sm text-slate-300">{d}</label>
                  <select id={`time-${d}`} className={cn(fieldCls(invalid.has(`time-${d}`)), "w-44")} value={times[d] ?? ""} disabled={loading}
                    onChange={(e) => {
                      const value = e.target.value;
                      // Setting a time also fills any other selected days that are still blank (never
                      // overwriting a day that already has one); each day stays editable on its own.
                      setTimes((cur) => {
                        const next = { ...cur, [d]: value };
                        if (value) for (const other of days) if (!next[other]) next[other] = value;
                        return next;
                      });
                      if (value) {
                        setLastTime(value);
                        for (const other of days) clear(`time-${other}`);
                      }
                      clear(`time-${d}`);
                    }}>
                    <option value="">Select duration</option>
                    {TIME_OPTIONS.map((t) => (
                      <option key={t} value={t}>{t}</option>
                    ))}
                  </select>
                </div>
                <div className="text-right">
                  <FieldError id={`time-${d}`} text={errors[`time-${d}`]} />
                </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Chunk>

      <Chunk icon={User} title="About You">
        <div>
          <label htmlFor="weight" className={labelCls}>Current Weight <Optional /></label>
          <div className="flex gap-2">
            <input id="weight" type="number" inputMode="decimal" min={0} step="0.1"
              className={fieldCls(invalid.has("weight"))} value={weight} disabled={loading}
              placeholder={weightUnit === "lbs" ? "e.g., 175" : "e.g., 78"}
              onChange={(e) => {
                setWeight(e.target.value);
                clear("weight");
              }} />
            <select aria-label="Weight unit" className={cn(fieldCls(), "w-24 shrink-0")} value={weightUnit} disabled={loading}
              onChange={(e) => {
                const unit = e.target.value as "lbs" | "kg";
                setWeightUnit(unit);
                if (!distanceTouched) setDistanceUnit(unit === "kg" ? "km" : "miles");
                clear("weight");
              }}>
              <option value="lbs">lbs</option>
              <option value="kg">kg</option>
            </select>
          </div>
          <FieldError id="weight" text={errors.weight} />
          <p className="mt-1 text-xs text-slate-500">Used to estimate calories burned in your summaries. Leave blank and we&apos;ll show ranges instead.</p>
        </div>
        <div>
          <label htmlFor="distance" className={labelCls}>Distance Units</label>
          <select id="distance" className={cn(fieldCls(), "w-40")} value={distanceUnit} disabled={loading}
            onChange={(e) => {
              setDistanceUnit(e.target.value as DistanceUnit);
              setDistanceTouched(true);
            }}>
            <option value="miles">Miles</option>
            <option value="km">Kilometers</option>
          </select>
          <p className="mt-1 text-xs text-slate-500">Used for running, walking and cycling distances. Defaults to km if you choose kg.</p>
        </div>
        <div>
          <label htmlFor="considerations" className={labelCls}>Special Considerations <Optional /></label>
          <textarea id="considerations" rows={2} maxLength={1000} className={fieldCls()} value={considerations} disabled={loading}
            placeholder="e.g., Sore left knee, no equipment at home, vegetarian"
            onChange={(e) => setConsiderations(e.target.value)} />
        </div>
      </Chunk>

      <button type="submit" disabled={loading}
        className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-emerald-500 px-4 py-3 font-semibold text-slate-950 shadow-sm transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-70">
        {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Sparkles className="h-5 w-5" />}
        {loading ? "Building your plan..." : "Generate Fitness Plan"}
      </button>
    </form>
  );
}

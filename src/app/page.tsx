"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Dumbbell, RotateCcw } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { IntakeForm } from "@/components/IntakeForm";
import { LoadingSkeleton } from "@/components/LoadingSkeleton";
import { SummaryCards } from "@/components/SummaryCards";
import type { SummaryScope } from "@/components/SummaryPanel";
import { WeeklyPlan, type PlanActions } from "@/components/WeeklyPlan";
import { arrayMove } from "@dnd-kit/sortable";
import { applyEstimates, dateFor, estimateKey, programBase, readableCompleted, summarySig, type ActivePlan, type Intake, type PlanDay, type PlanTask, type PlanWeek, type ProgramPlan, type ProgressSummary, type TaskEstimate } from "@/lib/fitness";

const localToday = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

const newId = () => `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

const STORAGE_KEY = "fitnesscoach_active_plan";

type View = "intake" | "dashboard";

export default function Home() {
  const [view, setView] = useState<View>("intake");
  const [active, setActive] = useState<ActivePlan | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planKey, setPlanKey] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  // Summaries currently being generated ("week-3", "to-date"); several can run at once.
  const [summaryLoading, setSummaryLoading] = useState<string[]>([]);
  const inFlight = useRef(new Set<string>());
  // Calorie/quantity estimates by task text + weight. Shared so two summaries that run at once make one
  // estimate request, and the same exercise always gets the same numbers.
  const estimateCache = useRef(new Map<string, TaskEstimate>());
  const estimatePending = useRef(new Map<string, Promise<TaskEstimate | undefined>>());
  const [summaryError, setSummaryError] = useState<string | null>(null);

  // Read localStorage only on the client, after mount, to avoid hydration mismatches.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as ActivePlan;
        if (saved?.plan?.weeks?.length > 0 && saved.intake?.startDate) {
          // Plans saved before weeks became Monday-Sunday laid their weeks out from the start date.
          // Keep them that way so none of their tasks move to a different date.
          if (!saved.intake.weekAnchor && programBase({ startDate: saved.intake.startDate }) !== saved.intake.startDate) {
            saved.intake = { ...saved.intake, weekAnchor: "start" };
          }
          setActive(saved);
          setView("dashboard");
          for (const w of saved.plan.weeks) for (const d of w.days) for (const t of d.tasks) if (t.est) estimateCache.current.set(t.est.key, t.est);
        }
      }
    } catch {
      /* storage unavailable or corrupt - start fresh */
    }
    setHydrated(true);
  }, []);

  // Persist on every change (including task check-offs).
  useEffect(() => {
    if (!hydrated || !active) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
    } catch {
      /* ignore */
    }
  }, [active, hydrated]);

  const generate = useCallback(async (formIntake: Intake) => {
    // New plans use calendar weeks (Monday to Sunday); the marker keeps them that way when reloaded.
    const intake: Intake = { ...formIntake, weekAnchor: "monday" };
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/generate-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(intake),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.weeks) throw new Error(json?.error ?? `Request failed (${res.status}).`);
      setActive({ plan: json as ProgramPlan, intake });
      setPlanKey((k) => k + 1);
      setSummaryError(null);
      setView("dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, []);

  /** Apply an edit to the plan (persisted by the effect above). */
  const updatePlan = useCallback((fn: (plan: ProgramPlan, intake: Intake) => ProgramPlan) => {
    setActive((cur) => (cur ? { ...cur, plan: fn(cur.plan, cur.intake) } : cur));
  }, []);

  const mapTasks = useCallback(
    (fn: (t: PlanTask) => PlanTask | null) =>
      updatePlan((plan) => ({
        ...plan,
        weeks: plan.weeks.map((w) => ({
          ...w,
          days: w.days.map((d) => ({ ...d, tasks: d.tasks.flatMap((t) => fn(t) ?? []) })),
        })),
      })),
    [updatePlan],
  );

  const mapDay = useCallback(
    (weekNumber: number, dayName: string, fn: (d: PlanDay | undefined) => PlanDay) =>
      updatePlan((plan, intake) => ({
        ...plan,
        weeks: plan.weeks.map((w): PlanWeek => {
          if (w.weekNumber !== weekNumber) return w;
          const exists = w.days.some((d) => d.dayName === dayName);
          const days = exists ? w.days.map((d) => (d.dayName === dayName ? fn(d) : d)) : [...w.days, fn(undefined)];
          // Keep days in calendar order within the week.
          days.sort((a, b) => (dateFor(intake, weekNumber, a.dayName) ?? "").localeCompare(dateFor(intake, weekNumber, b.dayName) ?? ""));
          return { ...w, days };
        }),
      })),
    [updatePlan],
  );

  const actions: PlanActions = {
    toggle: (id) => mapTasks((t) => (t.id === id ? { ...t, completed: !t.completed } : t)),
    edit: (id, patch) => mapTasks((t) => (t.id === id ? { ...t, ...patch } : t)),
    remove: (id) => mapTasks((t) => (t.id === id ? null : t)),
    add: (weekNumber, dayName) =>
      mapDay(weekNumber, dayName, (d) => {
        const task: PlanTask = { id: newId(), name: "", repsOrDuration: "", estimatedCalories: "", completed: false };
        return d ? { ...d, tasks: [...d.tasks, task] } : { dayName, focus: "Custom", tasks: [task] };
      }),
    reorder: (weekNumber, dayName, activeId, overId) =>
      mapDay(weekNumber, dayName, (d) => {
        if (!d) throw new Error("Unknown day");
        const from = d.tasks.findIndex((t) => t.id === activeId);
        const to = d.tasks.findIndex((t) => t.id === overId);
        return from < 0 || to < 0 ? d : { ...d, tasks: arrayMove(d.tasks, from, to) };
      }),
    editFocus: (weekNumber, dayName, focus) => mapDay(weekNumber, dayName, (d) => ({ ...(d as PlanDay), focus })),
  };

  /** Make sure every completed task has an estimate; only tasks whose text is new to us are sent. */
  const ensureEstimates = useCallback(async (plan: ProgramPlan, intake: Intake): Promise<Map<string, TaskEstimate>> => {
    const have = new Map(estimateCache.current);
    const tasks = readableCompleted(plan);
    for (const t of tasks) if (t.est && t.est.key === estimateKey(t, intake)) have.set(t.est.key, t.est);

    const waits: Promise<TaskEstimate | undefined>[] = [];
    const toFetch = new Map<string, { name: string; repsOrDuration: string }>();
    for (const t of tasks) {
      const key = estimateKey(t, intake);
      if (have.has(key)) continue;
      const pending = estimatePending.current.get(key);
      if (pending) waits.push(pending);
      else if (!toFetch.has(key)) toFetch.set(key, { name: t.name, repsOrDuration: t.repsOrDuration });
    }

    if (toFetch.size > 0) {
      const batch = fetch("/api/estimate-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ intake, tasks: [...toFetch.values()] }),
      })
        .then(async (res) => (res.ok ? ((await res.json()) as { estimates: Record<string, TaskEstimate> }).estimates : {}))
        .catch(() => ({}) as Record<string, TaskEstimate>); // the summary request will estimate (or report the error) itself
      for (const key of toFetch.keys()) {
        const p = batch.then((m) => m[key]).finally(() => estimatePending.current.delete(key));
        estimatePending.current.set(key, p);
        waits.push(p);
      }
    }

    for (const est of await Promise.all(waits)) if (est) have.set(est.key, est);
    for (const [k, v] of have) estimateCache.current.set(k, v);
    return have;
  }, []);

  const generateSummary = useCallback(
    async (scope: SummaryScope, weekNumber: number) => {
      if (!active) return;
      const key = scope === "week" ? `week-${weekNumber}` : "to-date";
      if (inFlight.current.has(key)) return;
      inFlight.current.add(key);
      setSummaryLoading([...inFlight.current]);
      setSummaryError(null);
      const asOf = localToday();
      try {
        const estimates = await ensureEstimates(active.plan, active.intake);
        const plan = applyEstimates(active.plan, active.intake, estimates);
        const res = await fetch("/api/generate-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ intake: active.intake, plan, scope, weekNumber, asOf }),
        });
        const json = await res.json().catch(() => null);
        if (!res.ok || json?.v !== 3) {
          throw new Error(json?.error ?? `The summary request failed (HTTP ${res.status}). Please try again.`);
        }
        // Estimates the server had to make itself are saved too, so later summaries reuse them.
        const fromServer = new Map<string, TaskEstimate>(Object.entries((json.estimates ?? {}) as Record<string, TaskEstimate>));
        for (const [k, v] of fromServer) estimateCache.current.set(k, v);
        const { estimates: _unused, ...summary } = json as ProgressSummary & { estimates?: unknown };
        void _unused;
        // Remember what this summary was built from so it can refresh itself when the plan changes.
        const sig = summarySig(active.plan, active.intake, scope, weekNumber, asOf);
        setActive((cur) =>
          cur && {
            ...cur,
            plan: applyEstimates(cur.plan, cur.intake, new Map([...estimates, ...fromServer])),
            summaries: { ...cur.summaries, [key]: { ...summary, sig } },
          },
        );
      } catch (e) {
        setSummaryError(
          e instanceof TypeError ? "Couldn't reach the server. Check that the app is still running and try again." : e instanceof Error ? e.message : "Something went wrong.",
        );
      } finally {
        inFlight.current.delete(key);
        setSummaryLoading([...inFlight.current]);
      }
    },
    [active, ensureEstimates],
  );

  const dismissSummary = useCallback((key: string) => {
    setSummaryError(null);
    setActive((cur) => {
      if (!cur?.summaries) return cur;
      const { [key]: _removed, ...rest } = cur.summaries;
      void _removed;
      return { ...cur, summaries: rest };
    });
  }, []);

  const [confirmingReset, setConfirmingReset] = useState(false);

  function startOver() {
    setConfirmingReset(false);
    setActive(null);
    setError(null);
    setView("intake");
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-8 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-emerald-500 p-2 text-slate-950">
            <Dumbbell className="h-6 w-6" />
          </div>
          <div>
            <h1 className="whitespace-nowrap text-xl font-bold text-white sm:text-2xl">FitnessCoach AI</h1>
            <p className="hidden text-sm text-slate-400 sm:block">A personalized training program, built around your week.</p>
          </div>
        </div>
        {view === "dashboard" && !loading && (
          <button
            type="button"
            onClick={() => setConfirmingReset(true)}
            className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-lg border border-slate-700 px-3 py-1.5 text-sm text-slate-200 hover:bg-slate-800"
          >
            <RotateCcw className="h-4 w-4" /> New plan
          </button>
        )}
      </header>

      {error && (
        <div role="alert" className="mb-6 flex items-start gap-2 rounded-xl border border-red-500/50 bg-red-950/50 p-4 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && <LoadingSkeleton />}
      {view === "dashboard" && active && !loading && (
        <div className="space-y-6">
          <SummaryCards active={active} />
          <WeeklyPlan
            key={planKey}
            active={active}
            actions={actions}
            summary={{ loadingKeys: summaryLoading, error: summaryError, onGenerate: generateSummary, onDismiss: dismissSummary }}
          />
        </div>
      )}
      {/* Stay mounted while loading so a failed request doesn't wipe what the user typed. */}
      {view === "intake" && (
        <div hidden={loading}>
          <IntakeForm loading={loading} onSubmit={generate} />
        </div>
      )}
      <ConfirmDialog
        open={confirmingReset}
        title="Start a new plan?"
        message="This removes your current plan, everything you've checked off and your summaries. This can't be undone."
        confirmLabel="Start new plan"
        cancelLabel="Keep my plan"
        onConfirm={startOver}
        onCancel={() => setConfirmingReset(false)}
      />
    </main>
  );
}

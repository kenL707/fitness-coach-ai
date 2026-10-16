"use client";

import { useEffect, useRef } from "react";
import { AlertCircle, CalendarRange, FileText, Flame, Loader2, RefreshCw, X } from "lucide-react";
import type { ProgressSummary } from "@/lib/fitness";
import { cn } from "@/lib/utils";

export type SummaryScope = "week" | "to-date";

interface Props {
  weekNumber: number;
  /** Program start date (YYYY-MM-DD); titles the since-start-date summary. */
  startDate: string;
  /** Fingerprints of the current plan data for each summary; a mismatch means an open summary is stale. */
  sigs: { week: string; toDate: string };
  summaries: Record<string, ProgressSummary>;
  /** Keys currently being generated ("week-3", "to-date"); both can be in flight together. */
  loadingKeys: string[];
  error: string | null;
  onGenerate: (scope: SummaryScope, weekNumber: number) => void;
  /** Remove a summary ("week-3" or "to-date"). */
  onDismiss: (key: string) => void;
}

const kcal = (c: string) => (c ? `${c} kcal` : "-");

/** MM-DD-YYYY from an ISO (YYYY-MM-DD) date. */
const mdy = (iso: string) => `${iso.slice(5, 7)}-${iso.slice(8, 10)}-${iso.slice(0, 4)}`;

const iconBtn = "rounded p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:cursor-not-allowed disabled:opacity-50";

interface CardProps {
  s: ProgressSummary;
  title: string;
  updating: boolean;
  onRefresh: () => void;
  onHide: () => void;
}

function SummaryCard({ s, title, updating, onRefresh, onHide }: CardProps) {
  return (
    <article aria-busy={updating} className="space-y-3 rounded-xl border border-slate-800 bg-slate-950/60 p-4">
      <header className="flex items-center justify-between gap-2">
        <h4 className="min-w-0 truncate text-base font-semibold text-white">{title}</h4>
        <span className="flex shrink-0 items-center gap-1 whitespace-nowrap text-xs text-slate-400">
          <span className="mr-1">{s.completed} of {s.total} completed</span>
          <button type="button" onClick={onRefresh} disabled={updating} aria-label={`Refresh ${title} summary`} title="Refresh" className={iconBtn}>
            <RefreshCw className={cn("h-4 w-4", updating && "animate-spin")} />
          </button>
          <button type="button" onClick={onHide} aria-label={`Hide ${title} summary`} title="Hide" className={iconBtn}>
            <X className="h-4 w-4" />
          </button>
        </span>
      </header>

      <div className={cn("space-y-3 transition-opacity", updating && "opacity-60")}>
        {s.groups.length === 0 && <p className="text-sm text-slate-400">No tasks to total yet.</p>}

        {s.groups.length > 0 && (
          <ul className="divide-y divide-slate-800 rounded-lg bg-slate-900">
            {s.groups.map((g, i) => (
              <li key={`${g.activity}-${i}`} className="flex items-baseline justify-between gap-3 px-3 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium text-slate-100">{g.activity}</span>
                  <span className="text-slate-400"> - {g.description}</span>
                </span>
                <span className="shrink-0 text-orange-300">{kcal(g.calories)}</span>
              </li>
            ))}
          </ul>
        )}

        <p className="flex items-center justify-between rounded-lg bg-orange-500/10 px-3 py-2 text-sm font-semibold text-orange-300">
          <span className="inline-flex items-center gap-1.5">
            <Flame className="h-4 w-4" /> Total calories burned
          </span>
          <span>{s.totalCalories === "0" ? "0 kcal" : `${s.totalCalories} kcal`}</span>
        </p>

        <p className="text-sm text-slate-300">{s.analysis}</p>
      </div>

      <p className="text-xs text-slate-500" aria-live="polite">
        {updating ? "Updating..." : `Updated ${new Date(s.generatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`}
      </p>
    </article>
  );
}

export function SummaryPanel({ weekNumber, startDate, sigs, summaries, loadingKeys, error, onGenerate, onDismiss }: Props) {
  const weekKey = `week-${weekNumber}`;
  const weekLoading = loadingKeys.includes(weekKey);
  const toDateLoading = loadingKeys.includes("to-date");
  // Ignore summaries saved in an older format.
  const weekSummary = summaries[weekKey]?.v === 3 ? summaries[weekKey] : undefined;
  const toDate = summaries["to-date"]?.v === 3 ? summaries["to-date"] : undefined;

  // Keep open summaries current: when the plan changes, refresh every out-of-date one at the same time
  // once editing pauses. Each plan state is tried at most once per summary, so a failing request can't
  // retry in a loop.
  const attempted = useRef<Record<string, string>>({});
  useEffect(() => {
    const stale = (key: string, s: ProgressSummary | undefined, sig: string, loading: boolean) =>
      !!s && !loading && s.sig !== undefined && s.sig !== sig && attempted.current[key] !== sig;
    const targets: { key: string; scope: SummaryScope; sig: string }[] = [];
    if (stale(weekKey, weekSummary, sigs.week, weekLoading)) targets.push({ key: weekKey, scope: "week", sig: sigs.week });
    if (stale("to-date", toDate, sigs.toDate, toDateLoading)) targets.push({ key: "to-date", scope: "to-date", sig: sigs.toDate });
    if (targets.length === 0) return;
    const timer = setTimeout(() => {
      for (const t of targets) {
        attempted.current[t.key] = t.sig;
        onGenerate(t.scope, weekNumber);
      }
    }, 2500);
    return () => clearTimeout(timer);
  }, [weekKey, weekNumber, weekSummary, toDate, weekLoading, toDateLoading, sigs.week, sigs.toDate, onGenerate]);

  const toggleBtn = (open: boolean) =>
    cn(
      "inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50",
      open
        ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
        : "border-slate-700 bg-slate-800 text-slate-100 hover:border-emerald-500 hover:text-emerald-300",
    );

  return (
    <section aria-label="Progress summaries" className="mt-6 space-y-4 border-t border-slate-800 pt-5">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={weekLoading && !weekSummary} aria-pressed={!!weekSummary} className={toggleBtn(!!weekSummary)}
          onClick={() => (weekSummary ? onDismiss(weekKey) : onGenerate("week", weekNumber))}>
          {weekLoading && !weekSummary ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileText className="h-4 w-4" />}
          Weekly summary
        </button>
        <button type="button" disabled={toDateLoading && !toDate} aria-pressed={!!toDate} className={toggleBtn(!!toDate)}
          onClick={() => (toDate ? onDismiss("to-date") : onGenerate("to-date", weekNumber))}>
          {toDateLoading && !toDate ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarRange className="h-4 w-4" />}
          Summary since start date
        </button>
      </div>

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-lg border border-red-500/50 bg-red-950/50 p-3 text-sm text-red-200">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      {/* Both present: weekly on the left, since-start-date on the right (stacked on small screens). */}
      {(weekSummary || toDate) && (
        <div className={weekSummary && toDate ? "grid items-start gap-4 md:grid-cols-2" : ""}>
          {weekSummary && (
            <SummaryCard s={weekSummary} title={weekSummary.label} updating={weekLoading}
              onRefresh={() => onGenerate("week", weekNumber)} onHide={() => onDismiss(weekKey)} />
          )}
          {toDate && (
            <SummaryCard s={toDate} title={`Since ${mdy(startDate)}`} updating={toDateLoading}
              onRefresh={() => onGenerate("to-date", weekNumber)} onHide={() => onDismiss("to-date")} />
          )}
        </div>
      )}
    </section>
  );
}

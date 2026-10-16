import type { ActivePlan } from "@/lib/fitness";

export function SummaryCards({ active }: { active: ActivePlan }) {
  const { plan } = active;

  return (
    <section aria-label="Plan summary" className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
      <h2 className="text-xl font-semibold text-white">{plan.programTitle}</h2>
      <p className="mt-1 text-sm text-slate-300">{plan.summary}</p>
    </section>
  );
}

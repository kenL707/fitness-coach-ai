import { Loader2 } from "lucide-react";

const bar = "animate-pulse rounded-2xl bg-slate-800";

export function LoadingSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-live="polite">
      <div className="flex items-center gap-2 text-sm text-slate-300">
        <Loader2 className="h-4 w-4 animate-spin text-emerald-400" />
        Your coach is building your program - this can take up to a minute.
      </div>
      <div className={`${bar} h-24`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={`${bar} h-28`} />
        ))}
      </div>
      <div className={`${bar} h-96`} />
    </div>
  );
}

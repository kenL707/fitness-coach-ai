"use client";

import { useEffect, useRef } from "react";
import { AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Modal confirmation built on the native <dialog>: focus is trapped, Escape cancels, background is inert. */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel, onConfirm, onCancel }: Props) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      // Escape fires "cancel"; keep our state in sync instead of letting the dialog close itself.
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
      // A click on the dimmed backdrop lands on the <dialog> element itself.
      onClick={(e) => {
        if (e.target === ref.current) onCancel();
      }}
      className="m-auto w-[calc(100%-2rem)] max-w-md rounded-2xl border border-slate-700 bg-slate-900 p-0 text-slate-100 shadow-2xl shadow-black/60 backdrop:bg-black/70 backdrop:backdrop-blur-sm"
    >
      <div className="p-6">
        <div className="flex items-start gap-4">
          <div className="shrink-0 rounded-full bg-red-500/15 p-3 text-red-400">
            <AlertTriangle className="h-6 w-6" />
          </div>
          <div className="min-w-0">
            <h2 id="confirm-title" className="text-lg font-semibold text-white">
              {title}
            </h2>
            <p id="confirm-message" className="mt-1 text-sm leading-relaxed text-slate-300">
              {message}
            </p>
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          {/* Cancel is the default focus so Enter can't destroy the plan by accident. */}
          <button
            type="button"
            autoFocus
            onClick={onCancel}
            className="rounded-lg border border-slate-700 px-4 py-2 text-sm font-medium text-slate-200 transition hover:bg-slate-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="rounded-lg bg-red-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-red-400"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </dialog>
  );
}

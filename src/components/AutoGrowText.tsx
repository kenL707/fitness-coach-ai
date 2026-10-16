"use client";

import { useLayoutEffect, useRef } from "react";
import { blurOnEnter, cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  "aria-label": string;
}

/**
 * A single-line-looking text field that wraps long text onto more lines instead of cutting it off
 * (important on a phone). Enter finishes the edit, so the value never contains line breaks.
 */
export function AutoGrowText({ value, onChange, className, placeholder, "aria-label": ariaLabel }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    fit();
    // Re-fit when the width changes (rotation, window resize), since wrapping changes with it.
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={1}
      value={value}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={blurOnEnter}
      className={cn("block resize-none overflow-hidden", className)}
    />
  );
}

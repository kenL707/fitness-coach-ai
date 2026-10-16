"use client";

import { useLayoutEffect, useRef } from "react";
import { blurOnEnter, cn } from "@/lib/utils";

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  id?: string;
  disabled?: boolean;
  maxLength?: number;
}

/**
 * A single-line-looking text field that wraps long text onto more lines instead of cutting it off
 * (important on a phone). Enter finishes the edit, so the value never contains line breaks.
 */
export function AutoGrowText({ value, onChange, className, placeholder, id, disabled, maxLength, ...aria }: Props) {
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
      id={id}
      value={value}
      disabled={disabled}
      maxLength={maxLength}
      placeholder={placeholder}
      {...aria}
      onChange={(e) => onChange(e.target.value.replace(/\s*\n\s*/g, " "))}
      onKeyDown={blurOnEnter}
      className={cn("block resize-none overflow-hidden", className)}
    />
  );
}

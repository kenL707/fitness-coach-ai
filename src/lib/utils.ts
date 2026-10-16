import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** onKeyDown for single-line edit fields: Enter finishes the edit (drops focus and the cursor). */
export function blurOnEnter(e: { key: string; preventDefault: () => void; currentTarget: { blur: () => void } }) {
  if (e.key === "Enter") {
    e.preventDefault();
    e.currentTarget.blur();
  }
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

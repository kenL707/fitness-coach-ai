import { afterEach } from "vitest";

// Browser-only setup: skipped for tests that run in the Node environment.
if (typeof window !== "undefined") {
  const { cleanup } = await import("@testing-library/react");
  await import("@testing-library/jest-dom/vitest");
  afterEach(() => {
    cleanup();
    localStorage.clear();
  });

  // jsdom has no ResizeObserver (used by the auto-growing text fields) ...
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  // ... and no scrollIntoView (used to bring the first invalid field into view) ...
  Element.prototype.scrollIntoView ??= () => {};
  // ... and only partly implements <dialog> (used by the confirmation dialog).
  HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
    this.removeAttribute("open");
  };
}

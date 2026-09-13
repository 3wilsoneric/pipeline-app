"use client";

import { flushSync } from "react-dom";
import { PIPELINE_NAVIGATION_EVENT } from "@/lib/pipeline/client-navigation";
import styles from "./ClientFolder.module.css";

let cancelPrevious: (() => void) | undefined;

/** Animate only the clicked preview. Never wait for a chart read or retain its data. */
export function openClientChart(source: HTMLElement, navigate: () => void) {
  cancelPrevious?.();
  if (!document.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.visibilityState === "hidden") {
    navigate();
    return;
  }

  const preview = source.querySelector<HTMLElement>("[data-client-chart-preview]") ?? source;
  const hadTransitionClass = preview.classList.contains(styles.transitionSurface);
  let transition: ViewTransition | undefined;
  let cancelled = false;
  let navigated = false;
  const cleanup = () => {
    if (!hadTransitionClass) preview.classList.remove(styles.transitionSurface);
    window.removeEventListener("popstate", cancel);
    window.removeEventListener(PIPELINE_NAVIGATION_EVENT, cancel);
    if (cancelPrevious === cancel) {
      document.documentElement.classList.remove(styles.transitionRoot);
      cancelPrevious = undefined;
    }
  };
  const cancel = () => {
    cancelled = true;
    transition?.skipTransition();
    cleanup();
  };
  cancelPrevious = cancel;
  preview.classList.add(styles.transitionSurface);
  document.documentElement.classList.add(styles.transitionRoot);
  window.addEventListener("popstate", cancel);

  try {
    transition = document.startViewTransition(() => {
      if (cancelled || navigated) return;
      navigated = true;
      flushSync(navigate);
      // A subsequent destination interrupts the visual, never the navigation.
      window.addEventListener(PIPELINE_NAVIGATION_EVENT, cancel);
    });
    void transition.ready.catch(() => undefined);
    void transition.finished.then(cleanup, cleanup);
  } catch {
    cleanup();
    if (!navigated && !cancelled) navigate();
  }
}

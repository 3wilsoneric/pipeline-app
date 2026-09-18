"use client";

import { useEffect, useRef } from "react";

// Keep the existing shell and its scroll owners. Mobile keyboards resize the
// visual viewport, not necessarily 100dvh. Never resize the UI during pinch zoom.
export function useMobileViewport() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const shell = ref.current;
    const viewport = window.visualViewport;
    if (!shell || !viewport) return;
    const compact = window.matchMedia("(max-width: 959px), (hover: none) and (pointer: coarse)");
    let frame = 0;
    let revealFocus = false;
    const update = () => {
      frame = 0;
      if (!compact.matches) {
        shell.style.removeProperty("--mobile-viewport-height");
        shell.style.removeProperty("--mobile-viewport-top");
      } else if (Math.abs(viewport.scale - 1) < 0.01) {
        shell.style.setProperty("--mobile-viewport-height", `${viewport.height}px`);
        shell.style.setProperty("--mobile-viewport-top", `${viewport.offsetTop}px`);
        const active = document.activeElement;
        if (revealFocus && active instanceof HTMLElement && shell.contains(active)
          && active.closest("[data-assessment-view], [data-assessment-scheduling]") && active.matches("input, textarea, select")) {
          active.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
        }
      }
      revealFocus = false;
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    const resize = () => { revealFocus = true; schedule(); };
    viewport.addEventListener("resize", resize);
    viewport.addEventListener("scroll", schedule);
    compact.addEventListener("change", resize);
    shell.addEventListener("focusin", resize);
    update();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener("resize", resize);
      viewport.removeEventListener("scroll", schedule);
      compact.removeEventListener("change", resize);
      shell.removeEventListener("focusin", resize);
      shell.style.removeProperty("--mobile-viewport-height");
      shell.style.removeProperty("--mobile-viewport-top");
    };
  }, []);
  return ref;
}

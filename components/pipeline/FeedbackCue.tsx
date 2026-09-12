"use client";

import { useEffect, useRef } from "react";

/** A decorative acknowledgement after an existing value changes, never on mount. */
export default function FeedbackCue({ value, enabled = true }: { value: string | number; enabled?: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const previous = useRef<string | number | null>(value);

  useEffect(() => {
    const changed = previous.current !== value;
    previous.current = enabled ? value : null;
    if (!changed || !enabled || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const animation = element.current?.animate(
      [{ opacity: 0.85, transform: "scaleX(0.45)" }, { opacity: 0, transform: "scaleX(1)" }],
      { duration: 320, easing: "ease-out" },
    );
    return () => animation?.cancel();
  }, [value, enabled]);

  return <span ref={element} aria-hidden="true" className="pipeline-feedback-cue" />;
}

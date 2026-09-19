"use client";

import { useSyncExternalStore } from "react";

const phoneQuery = "(max-width: 639px), (max-width: 959px) and (max-height: 500px) and (pointer: coarse)";
function subscribe(onChange: () => void) {
  const query = window.matchMedia(phoneQuery);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
export function usePhoneAssessment() {
  return useSyncExternalStore(subscribe, () => window.matchMedia(phoneQuery).matches, () => false);
}

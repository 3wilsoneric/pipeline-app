"use client";

import { createContext, useContext } from "react";

// Design switch for the staged redesign (docs/design/DECISIONS.md, "Rollout").
// The root layout decides once per request from PIPELINE_DESIGN_V2; components
// read it here so server and client markup always agree. Delete this file, and
// every branch that reads it, when the switch is removed.
const DesignV2Context = createContext(false);

export function DesignSwitchProvider({ v2, children }: { v2: boolean; children: React.ReactNode }) {
  return <DesignV2Context value={v2}>{children}</DesignV2Context>;
}

export function useDesignV2() {
  return useContext(DesignV2Context);
}

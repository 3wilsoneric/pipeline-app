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

// The redesign's look is retired (owner, 2026-09-26: "our original is just so much better"): the
// original design is the base again, so this always reports the original look. Its remaining
// branches and the v2 stylesheet blocks are dead and go in the cleanup (docs/design/DECISIONS.md,
// "Back to the original design").
export function useDesignV2() {
  return false;
}

// Features built during the redesign (quick notes, the Chart as home, interview context, last
// assessment suggestions, the referral summary box) stay behind PIPELINE_DESIGN_V2, in the original look.
export function useRedesignFeatures() {
  return useContext(DesignV2Context);
}

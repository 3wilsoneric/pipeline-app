"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchCurrentPipelineUser, onPipelineSessionCleared } from "@/lib/auth/authenticated-fetch";
import { StaffProfileController, emptyProfileState } from "./staff-profile-controller";

let owner: StaffProfileController | undefined;
let principal = "";
let session = 0;
onPipelineSessionCleared(() => { session++; owner?.dispose(); owner = undefined; principal = ""; });
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => emptyProfileState;

export function useStaffProfile() {
  const [controller, setController] = useState<StaffProfileController>();
  const [attempt, retry] = useState(0);
  const [failed, setFailed] = useState(false);
  useEffect(() => onPipelineSessionCleared(() => { setController(undefined); retry((value) => value + 1); }), []);
  useEffect(() => {
    let cancelled = false;
    const generation = session;
    void fetchCurrentPipelineUser().then(({ user }) => {
      if (cancelled || generation !== session) return;
      if (!user.id) throw new Error("Your profile settings could not be loaded.");
      if (!owner || principal !== user.id) { owner?.dispose(); owner = new StaffProfileController(user.id); principal = user.id; }
      setController(owner);
      setFailed(false);
      void owner.load();
    }).catch(() => { if (!cancelled && generation === session) setFailed(true); });
    return () => { cancelled = true; };
  }, [attempt]);
  const state = useSyncExternalStore(controller?.subscribe ?? emptySubscribe, controller?.snapshot ?? emptySnapshot, emptySnapshot);
  useEffect(() => () => controller?.flush(), [controller]);
  return { ...state, loading: failed ? false : state.loading, controller,
    message: failed ? { tone: "error" as const, text: "Your profile settings could not be loaded." } : state.message,
    reload: () => { if (controller) void controller.load(); else { setFailed(false); retry((value) => value + 1); } },
  };
}

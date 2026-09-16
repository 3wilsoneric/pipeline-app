"use client";

import { useEffect, useEffectEvent } from "react";
import { fetchCurrentPipelineUser } from "@/lib/auth/authenticated-fetch";
import { pendingOfflineAssessmentMutations, pendingOfflineRecoveryDrafts } from "@/lib/offline/offline-assessment-store";

const saves = new Set<() => Promise<void>>();

export function usePersonaSwitchSave(save: () => Promise<void>) {
  const saveLatest = useEffectEvent(save);
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_PIPELINE_PERSONA_DEMO !== "true") return;
    const registered = () => saveLatest();
    saves.add(registered);
    return () => { saves.delete(registered); };
  }, []);
}

export async function saveBeforePersonaSwitch() {
  for (const save of saves) await save();
  const { user } = await fetchCurrentPipelineUser();
  if (!user?.id) return;
  const [mutations, drafts] = await Promise.all([
    pendingOfflineAssessmentMutations(user.id), pendingOfflineRecoveryDrafts(user.id),
  ]);
  if (mutations + drafts > 0) throw new Error("Pending changes belong to this account. Reopen the workspace to finish syncing before switching accounts.");
}

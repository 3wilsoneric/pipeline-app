"use client";

import { useEffect, useEffectEvent } from "react";

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
}

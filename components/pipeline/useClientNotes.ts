"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { fetchCurrentPipelineUser, onPipelineSessionCleared } from "@/lib/auth/authenticated-fetch";
import { ClientNotesController, emptyNotes, type NotesStatus } from "./client-notes-controller";

export type { NotesStatus } from "./client-notes-controller";
const controllers = new Map<string, ClientNotesController>();
let session = 0;
onPipelineSessionCleared(() => {
  session += 1;
  controllers.forEach((controller) => controller.dispose());
  controllers.clear();
});
const emptySubscribe = () => () => undefined;
const emptySnapshot = () => emptyNotes;

export function useClientNotes(referralId: number, readOnly: boolean) {
  const [binding, setBinding] = useState<{ referralId: number; session: number; retry: number; owner?: ClientNotesController; failed?: boolean }>();
  const [sessionVersion, setSessionVersion] = useState(session);
  const [retry, setRetry] = useState(0);
  const current = binding?.referralId === referralId && binding.session === sessionVersion && binding.retry === retry ? binding : undefined;
  const controller = current?.owner;
  const accountFailed = Boolean(current?.failed);
  useEffect(() => onPipelineSessionCleared(() => { setBinding(undefined); setSessionVersion(session); }), []);
  useEffect(() => {
    let cancelled = false;
    const generation = session;
    void fetchCurrentPipelineUser().then(({ user }) => {
      if (cancelled || generation !== session) return;
      if (!user.id) throw new Error("Your account could not be confirmed for the pending copy.");
      const key = `${user.id}:${referralId}`;
      for (const [cachedKey, cached] of controllers) {
        if (cachedKey !== key && cached.canRelease()) { cached.dispose(); controllers.delete(cachedKey); }
      }
      let owner = controllers.get(key);
      if (!owner) { owner = new ClientNotesController(user.id, referralId); controllers.set(key, owner); }
      setBinding({ referralId, session: generation, retry, owner });
      void owner.load();
    }).catch(() => { if (!cancelled && generation === session) setBinding({ referralId, session: generation, retry, failed: true }); });
    return () => { cancelled = true; };
  }, [referralId, sessionVersion, retry]);
  const state = useSyncExternalStore(controller?.subscribe ?? emptySubscribe, controller?.snapshot ?? emptySnapshot, emptySnapshot);
  useEffect(() => {
    if (!controller) return;
    const onHide = () => { if (document.visibilityState === "hidden") controller.flushAll(); };
    const refresh = () => { void controller.load(); };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("online", controller.flushAll);
    window.addEventListener("focus", refresh);
    return () => { document.removeEventListener("visibilitychange", onHide); window.removeEventListener("online", controller.flushAll); window.removeEventListener("focus", refresh); controller.flushAll(); };
  }, [controller]);
  const status: NotesStatus = state.loadFailed || accountFailed ? "failed" : !state.loaded ? "loading"
    : Object.keys(state.failed).length || Object.keys(state.conflicts).length ? "failed"
    : Object.keys(state.waiting).length ? "waiting" : Object.keys(state.pending).length ? "saving" : "saved";
  return { ...state, loadFailed: state.loadFailed || accountFailed, status, readOnly,
    reload: () => { if (controller) void controller.load(); else setRetry((value) => value + 1); },
    change: (key: string, body: string) => { if (!readOnly) controller?.change(key, body); },
    flush: (key: string) => controller?.flush(key),
    resolve: (key: string, keep: "mine" | "theirs") => { if (!readOnly) controller?.resolve(key, keep); },
  };
}

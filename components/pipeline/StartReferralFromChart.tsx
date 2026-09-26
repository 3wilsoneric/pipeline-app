"use client";

import { useRef, useState } from "react";
import HomeDialog from "@/components/pipeline/HomeDialog";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";
import workspaceFolderStyles from "./ReferralWorkspaceFolder.module.css";

type PendingCreate = { sourceReferralId: number; mutationId: string; assigneeId: string };

export default function StartReferralFromChart({ sourceReferralId, allowed, inFolder = false, beforeStart }: {
  sourceReferralId?: number;
  allowed: boolean;
  inFolder?: boolean;
  beforeStart?: () => Promise<void>;
}) {
  const pendingCreate = useRef<PendingCreate | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [membersError, setMembersError] = useState("");
  const [retryPending, setRetryPending] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [open, setOpen] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [currentPrincipalId, setCurrentPrincipalId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  if (!sourceReferralId || !allowed) return null;
  async function showAssignment() {
    setOpen(true);
    setError("");
    const pending = pendingCreate.current?.sourceReferralId === sourceReferralId
      ? pendingCreate.current : readPendingCreate(sourceReferralId!);
    pendingCreate.current = pending;
    setRetryPending(Boolean(pending));
    if (pending) setAssigneeId(pending.assigneeId);
    else setStorageUnavailable(false);
    setMembersError("");
    setLoadingMembers(true);
    try {
      const result = await fetchPipelineJson<{ members: WorkspaceMember[]; current_principal_id: string }>("/api/members?scope=assessors", { cache: "no-store" });
      setMembers(result.members);
      setCurrentPrincipalId(result.current_principal_id);
    } catch {
      setMembers([]);
      setCurrentPrincipalId("");
      if (!pendingCreate.current) setAssigneeId("");
      setMembersError(pendingCreate.current
        ? "Assessor choices are unavailable. Your previous selection is preserved for retry."
        : "Assessor choices are unavailable. You can still create this intake with the default assignment.");
    } finally {
      setLoadingMembers(false);
    }
  }
  async function start() {
    if (busy.current) return;
    if (!sourceReferralId) return;
    if (new URLSearchParams(window.location.search).get("demo") === "1") {
      setError("Start new referrals from a saved chart outside practice mode.");
      return;
    }
    busy.current = true;
    setSaving(true);
    setError("");
    let postAttempted = false;
    try {
      await beforeStart?.();
      const attempt = pendingCreate.current?.sourceReferralId === sourceReferralId
        ? pendingCreate.current : { sourceReferralId, mutationId: crypto.randomUUID(), assigneeId };
      setStorageUnavailable(!rememberPendingCreate(attempt));
      pendingCreate.current = attempt;
      postAttempted = true;
      const result = await fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${sourceReferralId}/new-intake`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_mutation_id: attempt.mutationId, ...(attempt.assigneeId ? { assignee_id: attempt.assigneeId } : {}) }),
      });
      setOpen(false);
      pushPipelineHistory(`/?view=referrals&screen=packet&referralId=${result.referral.id}&workspaceStage=intake&workspaceField=name`);
      pendingCreate.current = null;
      forgetPendingCreate(sourceReferralId);
      setRetryPending(false);
      setStorageUnavailable(false);
    } catch (error) {
      if (postAttempted) {
        const rejected = error instanceof PipelineApiError && error.status > 0
          && error.status < 500 && ![408, 409, 429].includes(error.status);
        if (rejected) {
          pendingCreate.current = null;
          forgetPendingCreate(sourceReferralId);
          setStorageUnavailable(false);
        }
        setRetryPending(!rejected);
      }
      setError(error instanceof Error ? error.message : "The new intake could not be created. Try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const currentMember = members.find((member) => member.principal_id === currentPrincipalId);
  const canAssignOthers = !currentMember?.roles.includes("reviewer") || currentMember.roles.includes("assessment_coordinator") || currentMember.roles.includes("admin");
  const assignmentDialog = open ? <HomeDialog label="Assign new intake" title="Start a new intake" description="Choose an assessor or use the default assignment. Existing client records remain available." size="confirmation" onClose={() => { if (!saving) setOpen(false); }}>
    <div className="px-6 pb-6">
      <label htmlFor="chart-intake-assignee" className="mb-2 block text-[14px] font-semibold text-[#334a40]">Assessor</label>
      <select id="chart-intake-assignee" value={assigneeId} disabled={loadingMembers || saving || retryPending || Boolean(membersError)} onChange={(event) => setAssigneeId(event.target.value)} className="min-h-12 w-full rounded-md border border-[#bacfc5] bg-white px-3 text-[15px] text-[#243b32] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#08735e]">
        <option value="">{!currentMember ? "Default assignment" : canAssignOthers ? "Unassigned" : "Assign to me"}</option>
        {members.filter((member) => canAssignOthers || member.principal_id === currentPrincipalId).map((member) => <option key={member.principal_id} value={member.principal_id}>{member.display_name}</option>)}
        {retryPending && assigneeId && !members.some((member) => member.principal_id === assigneeId) ? <option value={assigneeId}>Previously selected assessor</option> : null}
      </select>
      {membersError ? <p role="status" className="mt-3 text-[13px] text-[#52655d]">{membersError}</p> : null}
      {retryPending ? <p role="status" className="mt-3 text-[13px] text-[#52655d]">The request may have created an intake. Retry with the same assessor to check its result. You can change the assignment after opening it.</p> : null}
      {storageUnavailable ? <p role="status" className="mt-3 text-[13px] text-[#52655d]">Keep this tab open and retry here until the intake is confirmed. This browser could not preserve the retry after a reload.</p> : null}
      {error ? <p role="alert" className="mt-3 text-[13px] text-[#a4473c]">{error}</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className="min-h-11 rounded-md border border-[#c6d6cf] px-5 text-[14px] font-semibold text-[#334a40]">Cancel</button>
        <button type="button" disabled={saving} onClick={() => void start()} className="min-h-11 rounded-md bg-[#08735e] px-5 text-[14px] font-bold text-white disabled:opacity-60">{saving ? "Creating intake..." : retryPending ? "Retry create intake" : "Create intake"}</button>
      </div>
    </div>
  </HomeDialog> : null;
  return <>
    <button type="button" aria-label="Create intake" title="Create intake" disabled={saving} onClick={() => void showAssignment()}
      className={inFolder ? workspaceFolderStyles.createTab : "min-h-10 border border-[#0f8b73] bg-white px-4 text-[13px] font-bold text-[#0c705f] hover:bg-[#effaf5] disabled:opacity-60"}>
      Create intake
    </button>
    {assignmentDialog}
  </>;
}

function pendingCreateKey(sourceReferralId: number) {
  return `pipeline.chart-intake-create.v1:${sourceReferralId}`;
}

function readPendingCreate(sourceReferralId: number): PendingCreate | null {
  try {
    const raw = window.sessionStorage.getItem(pendingCreateKey(sourceReferralId));
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<PendingCreate>;
    if (typeof value.mutationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.mutationId)
      || typeof value.assigneeId !== "string" || value.assigneeId.length > 256) return null;
    return { sourceReferralId, mutationId: value.mutationId, assigneeId: value.assigneeId };
  } catch {
    return null;
  }
}

function rememberPendingCreate({ sourceReferralId, mutationId, assigneeId }: PendingCreate) {
  try {
    window.sessionStorage.setItem(pendingCreateKey(sourceReferralId), JSON.stringify({ mutationId, assigneeId }));
    return true;
  } catch {
    return false;
  }
}

function forgetPendingCreate(sourceReferralId: number) {
  try { window.sessionStorage.removeItem(pendingCreateKey(sourceReferralId)); } catch { /* The confirmed server result remains authoritative. */ }
}

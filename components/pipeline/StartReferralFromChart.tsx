"use client";

import { useRef, useState } from "react";
import HomeDialog from "@/components/pipeline/HomeDialog";
import { fetchPipelineJson } from "@/lib/auth/authenticated-fetch";
import { pushPipelineHistory } from "@/lib/pipeline/client-navigation";
import type { Referral } from "@/lib/pipeline/referral-types";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";
import workspaceFolderStyles from "./ReferralWorkspaceFolder.module.css";

export default function StartReferralFromChart({ sourceReferralId, allowed, inFolder = false, beforeStart }: {
  sourceReferralId?: number;
  allowed: boolean;
  inFolder?: boolean;
  beforeStart?: () => Promise<void>;
}) {
  const mutationId = useRef<string | null>(null);
  const busy = useRef(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [members, setMembers] = useState<WorkspaceMember[]>([]);
  const [currentPrincipalId, setCurrentPrincipalId] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  if (!sourceReferralId || !allowed) return null;
  async function showAssignment() {
    setOpen(true);
    setError("");
    setLoadingMembers(true);
    try {
      const result = await fetchPipelineJson<{ members: WorkspaceMember[]; current_principal_id: string }>("/api/members?scope=assessors", { cache: "no-store" });
      setMembers(result.members);
      setCurrentPrincipalId(result.current_principal_id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Assessor list unavailable. Try again.");
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
    mutationId.current ??= crypto.randomUUID();
    try {
      await beforeStart?.();
      const result = await fetchPipelineJson<{ referral: Referral }>(`/api/referrals/${sourceReferralId}/new-intake`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_mutation_id: mutationId.current, ...(assigneeId ? { assignee_id: assigneeId } : {}) }),
      });
      setOpen(false);
      pushPipelineHistory(`/?view=referrals&screen=packet&referralId=${result.referral.id}&workspaceStage=intake`);
      mutationId.current = null;
    } catch (error) {
      setError(error instanceof Error ? error.message : "The new intake could not be created. Try again.");
    } finally {
      busy.current = false;
      setSaving(false);
    }
  }
  const currentMember = members.find((member) => member.principal_id === currentPrincipalId);
  const canAssignOthers = !currentMember?.roles.includes("reviewer") || currentMember.roles.includes("assessment_coordinator") || currentMember.roles.includes("admin");
  const assignmentDialog = open ? <HomeDialog label="Assign new intake" title="Start a new intake" description="Choose an assessor. The ALLO record stays in client history; this intake opens in Workspaces." size="confirmation" onClose={() => { if (!saving) setOpen(false); }}>
    <div className="px-6 pb-6">
      <label htmlFor="chart-intake-assignee" className="mb-2 block text-[14px] font-semibold text-[#334a40]">Assessor</label>
      <select id="chart-intake-assignee" value={assigneeId} disabled={loadingMembers || saving} onChange={(event) => setAssigneeId(event.target.value)} className="min-h-12 w-full rounded-md border border-[#bacfc5] bg-white px-3 text-[15px] text-[#243b32] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#08735e]">
        <option value="">{canAssignOthers ? "Unassigned" : "Assign to me"}</option>
        {members.filter((member) => canAssignOthers || member.principal_id === currentPrincipalId).map((member) => <option key={member.principal_id} value={member.principal_id}>{member.display_name}</option>)}
      </select>
      {error ? <p role="alert" className="mt-3 text-[13px] text-[#a4473c]">{error}</p> : null}
      <div className="mt-6 flex flex-wrap justify-end gap-3">
        <button type="button" disabled={saving} onClick={() => setOpen(false)} className="min-h-11 rounded-md border border-[#c6d6cf] px-5 text-[14px] font-semibold text-[#334a40]">Cancel</button>
        <button type="button" disabled={saving || loadingMembers || Boolean(error && members.length === 0)} onClick={() => void start()} className="min-h-11 rounded-md bg-[#08735e] px-5 text-[14px] font-bold text-white disabled:opacity-60">{saving ? "Creating intake..." : "Create intake"}</button>
      </div>
    </div>
  </HomeDialog> : null;
  return <>
    <button type="button" disabled={saving} onClick={() => void showAssignment()}
      className={inFolder ? workspaceFolderStyles.createTab : "min-h-10 border border-[#0f8b73] bg-white px-4 text-[13px] font-bold text-[#0c705f] hover:bg-[#effaf5] disabled:opacity-60"}>
      Create intake
    </button>
    {assignmentDialog}
  </>;
}

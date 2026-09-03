"use client";

import { useState } from "react";
import { ArrowRight, RotateCcw, ShieldCheck, UserRound, UsersRound, X } from "lucide-react";

import {
  clearPipelineClientSessionCache,
  fetchPipelineApi,
  fetchPipelineJson,
  type PipelineCurrentUser,
} from "@/lib/auth/authenticated-fetch";

type GodModeMember = {
  principal_id: string;
  display_name: string;
  identity_status: "entra_linked" | "provisional";
};

export function ActiveAssessorSessionPill({ user }: { user: PipelineCurrentUser | null }) {
  const [busy, setBusy] = useState(false);
  const delegation = user?.delegation;
  if (!delegation && !user?.assessorSessionRecoveryRequired) return null;
  const targetName = delegation?.target.name ?? "invalid account context";
  const administratorName = delegation?.initiatedBy.name ?? "administrator";

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void endAssessorSession().catch(() => setBusy(false));
      }}
      aria-label={delegation ? `Exit God mode for ${targetName}` : "Exit invalid God mode state"}
      title={`God mode: ${targetName}. Return to ${administratorName}.`}
      className="mr-1 flex h-10 items-center gap-2 rounded-md border border-[#d6a354] bg-[#fff8ed] px-2 text-left text-[#6f470b] outline-none hover:bg-[#ffefcf] focus-visible:ring-2 focus-visible:ring-[#a66b12] focus-visible:ring-offset-2 disabled:cursor-wait disabled:opacity-60 sm:mr-2 sm:px-3"
    >
      <ShieldCheck size={16} strokeWidth={1.9} aria-hidden="true" />
      <span className="hidden max-w-[180px] truncate text-[10px] font-black uppercase tracking-[0.08em] sm:block">{busy ? "Returning…" : delegation ? `God mode: ${targetName}` : "Exit invalid God mode"}</span>
      <RotateCcw size={14} strokeWidth={1.9} aria-hidden="true" />
    </button>
  );
}

export function AssessorSessionMenuAction({
  user,
  closeProfileMenu,
}: {
  user: PipelineCurrentUser | null;
  closeProfileMenu: () => void;
}) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [members, setMembers] = useState<GodModeMember[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  if (user?.delegation || user?.assessorSessionRecoveryRequired) {
    return <ReturnToAdministratorButton closeProfileMenu={closeProfileMenu} />;
  }
  if (!user?.roles.includes("admin")) return null;

  const openDialog = async () => {
    setDialogOpen(true);
    setStatus("Loading assessors…");
    try {
      const payload = await fetchPipelineJson<{ members: GodModeMember[] }>(
        "/api/auth/assessor-session",
        { cache: "no-store" },
      );
      setMembers(payload.members);
      setStatus(payload.members.length > 0 ? null : "No other active Pipeline accounts are available.");
    } catch (error) {
      setStatus(messageFor(error, "Pipeline accounts could not be loaded."));
    }
  };

  const startSession = async (principalId: string) => {
    setPendingId(principalId);
    setStatus(null);
    try {
      await fetchPipelineJson("/api/auth/assessor-session", {
        method: "POST",
        body: JSON.stringify({
          target_principal_id: principalId,
          reason: "Administrator God mode",
        }),
      });
      reloadWithFreshSession();
    } catch (error) {
      setPendingId(null);
      setStatus(messageFor(error, "God mode could not be started."));
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void openDialog()}
        className="grid min-h-[58px] w-full grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3 border-y border-l-[3px] border-y-[#e5e5e5] border-l-transparent px-4 py-3 text-left outline-none transition-colors hover:border-l-[#0f8b73] hover:bg-[#f7faf9] focus-visible:bg-[#edf7f3]"
      >
        <UsersRound size={17} strokeWidth={1.8} className="text-[#0f8b73]" aria-hidden="true" />
        <span><span className="block text-[11px] font-black text-[#111111]">God mode</span><span className="mt-0.5 block text-[9px] text-[#737373]">Open any user’s account and workspaces</span></span>
        <ArrowRight size={14} className="text-[#0f8b73]" aria-hidden="true" />
      </button>
      {dialogOpen ? (
        <AssessorSessionDialog
          members={members}
          pendingId={pendingId}
          status={status}
          onClose={() => setDialogOpen(false)}
          onSelect={(principalId) => void startSession(principalId)}
        />
      ) : null}
    </>
  );
}

function ReturnToAdministratorButton({ closeProfileMenu }: { closeProfileMenu: () => void }) {
  const [status, setStatus] = useState("Return to your account");
  return (
    <button
      type="button"
      onClick={() => {
        closeProfileMenu();
        setStatus("Returning…");
        void endAssessorSession().catch((error) => setStatus(messageFor(error, "Try again")));
      }}
      className="grid min-h-[58px] w-full grid-cols-[28px_minmax(0,1fr)_16px] items-center gap-3 border-y border-l-[3px] border-y-[#ead7b8] border-l-[#a66b12] bg-[#fff8ed] px-4 py-3 text-left outline-none transition-colors hover:bg-[#ffefcf] focus-visible:bg-[#ffefcf]"
    >
      <RotateCcw size={17} strokeWidth={1.9} className="text-[#8a5a10]" aria-hidden="true" />
      <span><span className="block text-[11px] font-black text-[#111111]">Exit God mode</span><span className="mt-0.5 block text-[9px] text-[#737373]">{status}</span></span>
      <ArrowRight size={14} className="text-[#8a5a10]" aria-hidden="true" />
    </button>
  );
}

function AssessorSessionDialog({
  members,
  pendingId,
  status,
  onClose,
  onSelect,
}: {
  members: GodModeMember[];
  pendingId: string | null;
  status: string | null;
  onClose: () => void;
  onSelect: (principalId: string) => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/35 p-4" role="presentation" onMouseDown={(event) => {
      if (event.currentTarget === event.target && !pendingId) onClose();
    }}>
      <section role="dialog" aria-modal="true" aria-labelledby="assessor-session-title" className="max-h-[min(720px,calc(100vh-2rem))] w-full max-w-[560px] overflow-hidden rounded-md border border-[#cfcfcf] border-t-[4px] border-t-[#0f8b73] bg-white shadow-[0_24px_64px_rgba(17,17,17,0.24)]">
        <div className="flex items-start justify-between gap-4 border-b border-[#e5e5e5] px-5 py-4">
          <div>
            <h2 id="assessor-session-title" className="text-[17px] font-black text-[#111111]">God mode</h2>
            <p className="mt-1 text-[12px] leading-5 text-[#666666]">Open any active Pipeline user’s account and workspaces while retaining administrator controls.</p>
          </div>
          <button type="button" autoFocus onClick={onClose} disabled={Boolean(pendingId)} aria-label="Close assessor picker" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#595959] outline-none hover:bg-[#f2f2f2] focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:opacity-40">
            <X size={18} strokeWidth={1.8} aria-hidden="true" />
          </button>
        </div>
        <div className="max-h-[520px] overflow-y-auto p-3">
          {members.map((member) => (
            <button
              key={member.principal_id}
              type="button"
              onClick={() => onSelect(member.principal_id)}
              disabled={Boolean(pendingId)}
              className="mb-2 flex min-h-[58px] w-full items-center gap-3 rounded-md border border-[#dedede] px-4 py-3 text-left outline-none transition-colors last:mb-0 hover:border-[#77b8a8] hover:bg-[#f3faf7] focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:cursor-wait disabled:opacity-55"
            >
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e6f5ef] text-[#0f8b73]"><UserRound size={17} strokeWidth={1.8} aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[13px] font-black text-[#111111]">{member.display_name}</span><span className="mt-0.5 block text-[10px] text-[#737373]">{member.identity_status === "provisional" ? "Imported Allo account" : "Microsoft-linked account"}</span></span>
              <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#0f8b73]">{pendingId === member.principal_id ? "Opening…" : "Open"}</span>
            </button>
          ))}
          {status ? <p role="status" className="px-2 py-4 text-center text-[12px] font-semibold text-[#6f470b]">{status}</p> : null}
        </div>
      </section>
    </div>
  );
}

async function endAssessorSession() {
  const response = await fetchPipelineApi("/api/auth/assessor-session", { method: "DELETE" });
  if (!response.ok && response.status !== 503) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error ?? "God mode could not be ended.");
  }
  reloadWithFreshSession();
}

function reloadWithFreshSession() {
  clearPipelineClientSessionCache();
  window.location.reload();
}

function messageFor(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

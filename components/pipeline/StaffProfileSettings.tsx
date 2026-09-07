"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { BadgeCheck, BriefcaseBusiness, LoaderCircle, Phone, Save, UserRound } from "lucide-react";

import TeamPresenceList from "@/components/pipeline/TeamPresenceList";
import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { StaffProfilePreferences } from "@/lib/pipeline/staff-profile";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";

type ProfileResponse = { member: WorkspaceMember };

const blankProfile: StaffProfilePreferences = {
  preferred_name: null,
  job_title: null,
  team: null,
  work_phone: null,
  time_zone: null,
  status_message: null,
};

const timeZones = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "UTC",
];

export default function StaffProfileSettings() {
  const [member, setMember] = useState<WorkspaceMember | null>(null);
  const [form, setForm] = useState<StaffProfilePreferences>(blankProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchPipelineJson<ProfileResponse>("/api/me/profile", { cache: "no-store" })
      .then((payload) => {
        if (cancelled) return;
        setMember(payload.member);
        setForm(profilePreferences(payload.member));
      })
      .catch((error) => {
        if (!cancelled) setMessage({ tone: "error", text: profileErrorMessage(error, "Your staff profile could not be loaded.") });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const updateField = (field: keyof StaffProfilePreferences, value: string) => {
    setMessage(null);
    setForm((current) => ({ ...current, [field]: value || null }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!member || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const payload = await fetchPipelineJson<ProfileResponse>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ if_match: member.profile.version, profile: form }),
      });
      setMember(payload.member);
      setForm(profilePreferences(payload.member));
      setMessage({ tone: "success", text: "Profile preferences saved." });
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409) {
        const latest = (error.payload as Partial<ProfileResponse> | undefined)?.member;
        if (latest) {
          setMember(latest);
          setForm(profilePreferences(latest));
        }
      }
      setMessage({ tone: "error", text: profileErrorMessage(error, "Your profile could not be saved.") });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-[#f5f7f6]">
      <div className="mx-auto w-full max-w-[1180px] px-4 py-8 sm:px-6 lg:px-8 lg:py-10">
        <header className="border-b border-[#cfd6d2] pb-6">
          <div className="text-[10px] font-black uppercase tracking-[0.16em] text-[#0f8b73]">Account</div>
          <h1 className="mt-2 text-[30px] font-black tracking-[-0.03em] text-[#111111] sm:text-[38px]">Staff profile</h1>
          <p className="mt-2 max-w-[720px] text-[12px] leading-5 text-[#595959]">
            Keep your team-facing details useful without changing the Microsoft identity, role, or clinical audit name tied to your account.
          </p>
        </header>

        {loading ? (
          <div className="mt-6 flex min-h-48 items-center justify-center border border-[#d9dfdb] bg-white text-[#0f8b73]" role="status">
            <LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" />
            <span className="ml-2 text-[11px] font-black">Loading profile</span>
          </div>
        ) : member ? (
          <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
            <form onSubmit={save} className="border border-[#d9dfdb] bg-white" aria-label="Edit staff profile">
              <section className="border-b border-[#e2e6e3] px-5 py-5 sm:px-7">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-4">
                    <span className="relative flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#b8dacf] bg-[#eff8f5] text-[#0f8b73]">
                      <UserRound size={25} strokeWidth={1.7} aria-hidden="true" />
                      <span aria-hidden="true" className="absolute bottom-0 right-0 h-3.5 w-3.5 rounded-full border-[3px] border-white bg-[#20a464]" />
                    </span>
                    <div className="min-w-0">
                      <div className="truncate text-[17px] font-black text-[#111111]">{form.preferred_name || member.display_name}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] font-bold text-[#3d715f]"><BadgeCheck size={13} aria-hidden="true" /> Online · Microsoft verified</div>
                    </div>
                  </div>
                  <span className="rounded-full border border-[#b8dacf] bg-[#f4faf7] px-3 py-1 text-[9px] font-black uppercase tracking-[0.1em] text-[#0f6f5d]">Staff account</span>
                </div>
              </section>

              <section className="px-5 py-6 sm:px-7">
                <h2 className="text-[14px] font-black text-[#111111]">Organization-managed identity</h2>
                <p className="mt-1 text-[10px] leading-4 text-[#737373]">These values come from sign-in and determine assignment, permissions, and audit attribution.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <ReadOnlyField label="Authenticated name" value={member.display_name} />
                  <ReadOnlyField label="Work email" value={member.email || "Not available"} />
                  <ReadOnlyField label="Access roles" value={member.roles.map(roleLabel).join(" · ") || "Viewer"} />
                  <ReadOnlyField label="Identity status" value={identityLabel(member.identity_status)} />
                </div>
              </section>

              <section className="border-t border-[#e2e6e3] px-5 py-6 sm:px-7">
                <div className="flex items-center gap-2">
                  <BriefcaseBusiness size={17} className="text-[#0f8b73]" aria-hidden="true" />
                  <h2 className="text-[14px] font-black text-[#111111]">Editable team details</h2>
                </div>
                <p className="mt-1 text-[10px] leading-4 text-[#737373]">These details help coworkers recognize and reach you. Leaving a field blank simply hides it.</p>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <TextField label="Preferred name" value={form.preferred_name} maxLength={80} onChange={(value) => updateField("preferred_name", value)} />
                  <TextField label="Job title" value={form.job_title} maxLength={120} onChange={(value) => updateField("job_title", value)} />
                  <TextField label="Team or program" value={form.team} maxLength={120} onChange={(value) => updateField("team", value)} />
                  <TextField label="Work phone" value={form.work_phone} maxLength={40} inputMode="tel" icon={<Phone size={14} aria-hidden="true" />} onChange={(value) => updateField("work_phone", value)} />
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">Time zone</span>
                    <select value={form.time_zone ?? ""} onChange={(event) => updateField("time_zone", event.target.value)} className="mt-1.5 h-11 w-full border border-[#c9ceca] bg-white px-3 text-[12px] font-semibold text-[#222222] outline-none focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73]">
                      <option value="">Not shown</option>
                      {form.time_zone && !timeZones.includes(form.time_zone) ? <option value={form.time_zone}>{form.time_zone.replaceAll("_", " ")}</option> : null}
                      {timeZones.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <TextField label="Status message" value={form.status_message} maxLength={120} placeholder="Available for intake questions" onChange={(value) => updateField("status_message", value)} />
                </div>
              </section>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d9dfdb] bg-[#f8faf9] px-5 py-4 sm:px-7">
                <div aria-live="polite" className={`min-h-4 text-[10px] font-bold ${message?.tone === "error" ? "text-[#a63d2f]" : "text-[#167b58]"}`}>
                  {message?.text ?? (member.profile.updated_at ? `Last saved ${formatUpdatedAt(member.profile.updated_at)}` : "Not customized yet")}
                </div>
                <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-white outline-none hover:bg-[#0b6f5d] disabled:cursor-wait disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
                  {saving ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                  {saving ? "Saving" : "Save profile"}
                </button>
              </footer>
            </form>

            <aside className="space-y-5">
              <TeamPresenceList />
              <section className="border border-[#d9dfdb] bg-[#fbfcfb] p-5">
                <h2 className="text-[13px] font-black text-[#111111]">What stays locked</h2>
                <p className="mt-2 text-[10px] leading-5 text-[#666666]">Name, email, access roles, and identity status are managed by the organization. This prevents a profile edit from changing access, assignments, or who appears in the audit trail.</p>
              </section>
            </aside>
          </div>
        ) : (
          <div role="alert" className="mt-6 border border-[#e1b6ad] bg-[#fff5f2] px-5 py-4 text-[11px] font-bold text-[#a63d2f]">
            {message?.text ?? "Your staff profile could not be loaded."}
          </div>
        )}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  maxLength,
  placeholder,
  inputMode,
  icon,
  onChange,
}: {
  label: string;
  value: string | null;
  maxLength: number;
  placeholder?: string;
  inputMode?: "tel";
  icon?: ReactNode;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">{label}</span>
      <span className="relative mt-1.5 block">
        {icon ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[#737373]">{icon}</span> : null}
        <input value={value ?? ""} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder} inputMode={inputMode} className={`h-11 w-full border border-[#c9ceca] bg-white px-3 text-[12px] font-semibold text-[#222222] outline-none placeholder:text-[#a0a0a0] focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73] ${icon ? "pl-9" : ""}`} />
      </span>
    </label>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] font-black uppercase tracking-[0.08em] text-[#8a8a8a]">{label}</div>
      <div className="mt-1 break-words text-[11px] font-bold text-[#333333]">{value}</div>
    </div>
  );
}

function profilePreferences(member: WorkspaceMember): StaffProfilePreferences {
  return {
    preferred_name: member.profile.preferred_name,
    job_title: member.profile.job_title,
    team: member.profile.team,
    work_phone: member.profile.work_phone,
    time_zone: member.profile.time_zone,
    status_message: member.profile.status_message,
  };
}

function roleLabel(role: string) {
  if (role === "assessment_coordinator") return "Assessment coordinator";
  return role.charAt(0).toUpperCase() + role.slice(1).replaceAll("_", " ");
}

function identityLabel(status: WorkspaceMember["identity_status"]) {
  if (status === "entra_linked") return "Microsoft verified";
  if (status === "provisional") return "Pending account link";
  return "Merged account";
}

function profileErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

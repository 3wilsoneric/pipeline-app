"use client";

import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, BriefcaseBusiness, LayoutDashboard, LoaderCircle, Phone, Save } from "lucide-react";

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
        if (!cancelled) setMessage({ tone: "error", text: profileErrorMessage(error, "Your profile settings could not be loaded.") });
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
    <StaffProfileSettingsView
      member={member}
      form={form}
      loading={loading}
      saving={saving}
      message={message}
      onSave={save}
      onUpdateField={updateField}
    />
  );
}

function StaffProfileSettingsView({ member, form, loading, saving, message, onSave, onUpdateField }: {
  member: WorkspaceMember | null;
  form: StaffProfilePreferences;
  loading: boolean;
  saving: boolean;
  message: { tone: "success" | "error"; text: string } | null;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdateField: (field: keyof StaffProfilePreferences, value: string) => void;
}) {
  return (
    <div className="h-full overflow-y-auto bg-white">
      <div className="mx-auto w-full max-w-[1080px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <header className="pb-5">
          <h1 className="text-[26px] font-black text-[#111111] sm:text-[30px]">Profile settings</h1>
          <p className="mt-1 text-[12px] leading-5 text-[#666b68]">Manage how your account appears and how Pipeline is arranged for you.</p>
        </header>

        <ProfileSettingsBody member={member} form={form} loading={loading} saving={saving} message={message} onSave={onSave} onUpdateField={onUpdateField} />
      </div>
    </div>
  );
}

function ProfileSettingsBody({ member, form, loading, saving, message, onSave, onUpdateField }: {
  member: WorkspaceMember | null;
  form: StaffProfilePreferences;
  loading: boolean;
  saving: boolean;
  message: { tone: "success" | "error"; text: string } | null;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdateField: (field: keyof StaffProfilePreferences, value: string) => void;
}) {
  if (loading) return <div className="mt-6 flex min-h-48 items-center justify-center border border-[#d9dfdb] bg-white text-[#0f8b73]" role="status"><LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /><span className="ml-2 text-[11px] font-black">Loading profile</span></div>;
  if (!member) return <div role="alert" className="mt-6 border border-[#e1b6ad] bg-[#fff5f2] px-5 py-4 text-[11px] font-bold text-[#a63d2f]">{message?.text ?? "Your profile settings could not be loaded."}</div>;

  return <LoadedProfileSettings member={member} form={form} saving={saving} message={message} onSave={onSave} onUpdateField={onUpdateField} />;
}

function LoadedProfileSettings({ member, form, saving, message, onSave, onUpdateField }: {
  member: WorkspaceMember;
  form: StaffProfilePreferences;
  saving: boolean;
  message: { tone: "success" | "error"; text: string } | null;
  onSave: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onUpdateField: (field: keyof StaffProfilePreferences, value: string) => void;
}) {
  return (
    <div className="grid gap-8 border-t border-[#cfd6d2] pt-6 lg:grid-cols-[minmax(0,1fr)_280px] lg:gap-12">
            <form onSubmit={onSave} className="min-w-0" aria-label="Profile settings">
              <section className="border-b border-[#e2e6e3] pb-6">
                <div className="truncate text-[18px] font-black text-[#111111]">{form.preferred_name || member.display_name}</div>
                <div className="mt-1 truncate text-[11px] text-[#666b68]">{member.email || "Microsoft account"}</div>
              </section>

              <section className="border-b border-[#e2e6e3] py-6">
                <h2 className="text-[15px] font-black text-[#111111]">Microsoft account</h2>
                <p className="mt-1 text-[11px] leading-5 text-[#737373]">Your organization controls these sign-in and access details.</p>
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <ReadOnlyField label="Account name" value={member.display_name} />
                  <ReadOnlyField label="Work email" value={member.email || "Not available"} />
                  <ReadOnlyField label="Access roles" value={member.roles.map(roleLabel).join(" · ") || "Viewer"} />
                  <ReadOnlyField label="Sign-in status" value={identityLabel(member.identity_status)} />
                </div>
              </section>

              <section className="py-6">
                <div className="flex items-center gap-2">
                  <BriefcaseBusiness size={17} className="text-[#0f8b73]" aria-hidden="true" />
                  <h2 className="text-[15px] font-black text-[#111111]">Profile details</h2>
                </div>
                <p className="mt-1 text-[11px] leading-5 text-[#737373]">These details help your team recognize and reach you.</p>
                <div className="mt-5 grid gap-5 sm:grid-cols-2">
                  <TextField label="Preferred name" value={form.preferred_name} maxLength={80} onChange={(value) => onUpdateField("preferred_name", value)} />
                  <TextField label="Job title" value={form.job_title} maxLength={120} onChange={(value) => onUpdateField("job_title", value)} />
                  <TextField label="Team or program" value={form.team} maxLength={120} onChange={(value) => onUpdateField("team", value)} />
                  <TextField label="Work phone" value={form.work_phone} maxLength={40} inputMode="tel" icon={<Phone size={14} aria-hidden="true" />} onChange={(value) => onUpdateField("work_phone", value)} />
                  <label className="block">
                    <span className="text-[10px] font-black uppercase tracking-[0.08em] text-[#595959]">Time zone</span>
                    <select value={form.time_zone ?? ""} onChange={(event) => onUpdateField("time_zone", event.target.value)} className="mt-1.5 h-11 w-full border border-[#c9ceca] bg-white px-3 text-[12px] font-semibold text-[#222222] outline-none focus:border-[#0f8b73] focus:ring-1 focus:ring-[#0f8b73]">
                      <option value="">Not shown</option>
                      {form.time_zone && !timeZones.includes(form.time_zone) ? <option value={form.time_zone}>{form.time_zone.replaceAll("_", " ")}</option> : null}
                      {timeZones.map((timeZone) => <option key={timeZone} value={timeZone}>{timeZone.replaceAll("_", " ")}</option>)}
                    </select>
                  </label>
                  <TextField label="Status message" value={form.status_message} maxLength={120} placeholder="Available for intake questions" onChange={(value) => onUpdateField("status_message", value)} />
                </div>
              </section>

              <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[#d9dfdb] py-4">
                <div aria-live="polite" className={`min-h-4 text-[10px] font-bold ${message?.tone === "error" ? "text-[#a63d2f]" : "text-[#167b58]"}`}>
                  {message?.text ?? (member.profile.updated_at ? `Last saved ${formatUpdatedAt(member.profile.updated_at)}` : "Not customized yet")}
                </div>
                <button type="submit" disabled={saving} className="inline-flex h-10 items-center gap-2 bg-[#0f8b73] px-4 text-[10px] font-black uppercase tracking-[0.08em] text-white outline-none hover:bg-[#0b6f5d] disabled:cursor-wait disabled:opacity-60 focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2">
                  {saving ? <LoaderCircle size={14} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save size={14} aria-hidden="true" />}
                  {saving ? "Saving" : "Save changes"}
                </button>
              </footer>
            </form>

            <aside className="space-y-6 lg:border-l lg:border-[#e2e6e3] lg:pl-8">
              <section className="border-b border-[#e2e6e3] pb-6">
                <div className="flex items-center gap-2">
                  <LayoutDashboard size={17} className="text-[#0f8b73]" aria-hidden="true" />
                  <h2 className="text-[13px] font-black text-[#111111]">Home layout</h2>
                </div>
                <p className="mt-2 text-[11px] leading-5 text-[#666666]">Choose and arrange the modules on your Home screen.</p>
                <Link
                  href="/?editHome=1"
                  aria-label="Edit Home"
                  className="mt-3 flex h-10 items-center justify-between border-t border-[#e2e6e3] pt-2 text-[11px] font-black text-[#176f60] outline-none hover:text-[#0b725f] focus-visible:ring-2 focus-visible:ring-[#0f8b73]"
                >
                  Edit Home <ArrowRight size={14} aria-hidden="true" />
                </Link>
              </section>
              <section>
                <h2 className="text-[13px] font-black text-[#111111]">Account access</h2>
                <p className="mt-2 text-[11px] leading-5 text-[#666666]">Name, email, roles, and sign-in status are organization-managed so assignments and audit history stay reliable.</p>
              </section>
            </aside>
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

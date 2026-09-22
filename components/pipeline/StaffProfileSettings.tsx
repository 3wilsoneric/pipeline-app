"use client";

import { useEffect, useEffectEvent, useRef, useState } from "react";
import type { FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, BookUser, ChevronDown, LayoutDashboard, LoaderCircle, Mail, Save } from "lucide-react";

import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import type { StaffProfilePreferences } from "@/lib/pipeline/staff-profile";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";
import { canAccessOperationsReports, canAccessSupervisorOperations } from "@/lib/pipeline/report-access";
import ContactDirectoryImport from "@/components/pipeline/ContactDirectoryImport";
import OutlookConnectionSetup from "./OutlookConnectionSetup";
import { usePipelineShell } from "./pipeline-shell-context";
import { useConfirmationDialog } from "./useConfirmationDialog";
import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";
import styles from "./StaffProfileSettings.module.css";

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
  ["America/Los_Angeles", "Pacific time"],
  ["America/Denver", "Mountain time"],
  ["America/Chicago", "Central time"],
  ["America/New_York", "Eastern time"],
  ["UTC", "UTC"],
];

export default function StaffProfileSettings() {
  const [member, setMember] = useState<WorkspaceMember | null>(null);
  const [form, setForm] = useState<StaffProfilePreferences>(blankProfile);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [conflict, setConflict] = useState(false);
  const pending = useRef(false);
  const { beforeNavigationRef } = usePipelineShell();
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const router = useRouter();
  const dirty = Boolean(member && JSON.stringify(form) !== JSON.stringify(profilePreferences(member)));
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
  }, [loadAttempt]);

  const updateField = (field: keyof StaffProfilePreferences, value: string) => {
    setMessage(null);
    setForm((current) => ({ ...current, [field]: value || null }));
  };

  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!member || pending.current || (!dirty && !conflict)) return;
    pending.current = true;
    setSaving(true);
    setMessage(null);
    try {
      const payload = await fetchPipelineJson<ProfileResponse>("/api/me/profile", {
        method: "PATCH",
        body: JSON.stringify({ if_match: member.profile.version, profile: form }),
      });
      setMember(payload.member);
      setForm(profilePreferences(payload.member));
      setConflict(false);
      setMessage({ tone: "success", text: "Profile saved." });
    } catch (error) {
      if (error instanceof PipelineApiError && error.status === 409) {
        const latest = (error.payload as Partial<ProfileResponse> | undefined)?.member;
        if (latest) {
          // Keep locally edited fields; carry forward remote changes to untouched fields.
          const next = mergeProfileEdits(member, latest, form);
          setMember(latest);
          setForm(next);
          setConflict(true);
          setMessage({ tone: "error", text: "Your profile changed in another session. Your edits are still here. Review them, then save again." });
          return;
        }
      }
      setMessage({ tone: "error", text: profileErrorMessage(error, "Your profile could not be saved. Your edits are still here.") });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };

  const beforeLeave = async () => {
    if (pending.current) {
      setMessage({ tone: "error", text: "Your profile is saving. Please wait before leaving." });
      throw new Error("Profile save in progress.");
    }
    if (!dirty && !conflict) return;
    if (!await confirm({ title: "Leave without saving?", message: "Your profile changes have not been saved.", confirmLabel: "Discard changes", cancelLabel: "Keep editing", destructive: true })) {
      throw new Error("Unsaved profile changes.");
    }
    setForm(profilePreferences(member!));
    setConflict(false);
  };
  const beforeLeaveLatest = useEffectEvent(beforeLeave);
  usePersonaSwitchSave(beforeLeave);
  useEffect(() => {
    const guard = () => beforeLeaveLatest();
    beforeNavigationRef.current = guard;
    return () => { if (beforeNavigationRef.current === guard) beforeNavigationRef.current = null; };
  }, [beforeNavigationRef]);
  useEffect(() => {
    if (!dirty && !saving && !conflict) return;
    const leave = (event: BeforeUnloadEvent) => event.preventDefault();
    const link = (event: MouseEvent) => {
      if (!isPlainProfileClick(event)) return;
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download") || anchor.origin !== window.location.origin) return;
      event.preventDefault(); event.stopPropagation();
      void beforeLeaveLatest().then(() => router.push(`${anchor.pathname}${anchor.search}${anchor.hash}`)).catch(() => undefined);
    };
    window.addEventListener("beforeunload", leave);
    document.addEventListener("click", link, true);
    return () => { window.removeEventListener("beforeunload", leave); document.removeEventListener("click", link, true); };
  }, [dirty, saving, conflict, router]);

  const renderSaveBar = (member: WorkspaceMember) => (
            <footer className={styles.saveBar}>
              <p role={message?.tone === "error" ? "alert" : "status"} className={message?.tone === "error" ? styles.error : styles.saveStatus}>
                {profileSaveStatus(saving, message?.text, dirty, member.profile.updated_at)}
              </p>
              <button type="submit" disabled={saving || (!dirty && !conflict)} className={styles.primary}>
                {saving ? <LoaderCircle size={17} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> : <Save size={17} aria-hidden="true" />}
                {saving ? "Saving…" : conflict ? "Save reviewed changes" : "Save changes"}
              </button>
            </footer>
  );
  const renderProfileForm = (member: WorkspaceMember) => (
          <form onSubmit={save} className={styles.card} aria-label="Profile settings" aria-busy={saving}>
            <div className={styles.sectionHeader}><h2>Your profile</h2><p>How your team recognizes and reaches you.</p></div>
            <fieldset disabled={saving} className={styles.fields}>
              <legend className="sr-only">Profile details</legend>
              <TextField label="Preferred name" value={form.preferred_name} maxLength={80} placeholder={member.display_name} autoComplete="nickname" onChange={(value) => updateField("preferred_name", value)} />
              <TextField label="Work phone" value={form.work_phone} maxLength={40} type="tel" autoComplete="tel" onChange={(value) => updateField("work_phone", value)} />
              <TextField label="Job title" value={form.job_title} maxLength={120} autoComplete="organization-title" onChange={(value) => updateField("job_title", value)} />
              <TextField label="Team or program" value={form.team} maxLength={120} onChange={(value) => updateField("team", value)} />
              <label className={styles.field}><span>Profile time zone</span>
                <select value={form.time_zone ?? ""} onChange={(event) => updateField("time_zone", event.target.value)}>
                  <option value="">Not set</option>
                  {form.time_zone && !timeZones.some(([zone]) => zone === form.time_zone) ? <option value={form.time_zone}>{form.time_zone.replaceAll("_", " ")}</option> : null}
                  {timeZones.map(([zone, label]) => <option key={zone} value={zone}>{label}</option>)}
                </select>
              </label>
              <TextField label="Status message" value={form.status_message} maxLength={120} placeholder="Available for intake questions" onChange={(value) => updateField("status_message", value)} />
            </fieldset>
            {renderSaveBar(member)}
          </form>
  );

  return <div className={`${styles.page} pipeline-page-surface`}>
    {confirmationDialog}
    <div className={styles.content}>
      <header className={styles.header}>
        <h1>Settings</h1>
        <p>Contacts, your profile, and your workspace.</p>
      </header>
      {loading ? <div className={styles.loading} role="status"><LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading settings</div>
        : !member ? <div className={styles.card}>
          <p role="alert" className={styles.error}>{message?.text ?? "Your settings could not be loaded."}</p>
          <button className={styles.secondary} onClick={() => { setLoading(true); setMessage(null); setLoadAttempt((value) => value + 1); }}>Try again</button>
        </div> : <>
          <ContactSettings member={member} />
          <OutlookConnectionSetup mode="settings" />
          {renderProfileForm(member)}
          <section className={styles.card} aria-label="Workspace settings">
            <Link href="/?editHome=1" aria-label="Edit Home" className={styles.settingRow}>
              <span className={styles.icon}><LayoutDashboard size={21} aria-hidden="true" /></span>
              <span className={styles.rowText}><strong>Home layout</strong><span>Choose and arrange the sections on your Home screen.</span></span>
              <ArrowRight size={19} aria-hidden="true" />
            </Link>
          </section>
          <section className={styles.account} aria-labelledby="settings-account">
            <div className={styles.sectionHeader}><h2 id="settings-account">Account & access</h2><p>Managed by your organization.</p></div>
            <dl className={styles.accountFields}>
              <ReadOnlyField label="Account name" value={member.display_name} />
              <ReadOnlyField label="Work email" value={member.email || "Not available"} />
              <ReadOnlyField label="Access roles" value={member.roles.map(roleLabel).join(" · ") || "Viewer"} />
              <ReadOnlyField label="Sign-in status" value={identityLabel(member.identity_status)} />
            </dl>
          </section>
        </>}
    </div>
  </div>;
}

function ContactSettings({ member }: { member: WorkspaceMember }) {
  const listsAvailable = canAccessOperationsReports({ ...member, id: member.principal_id }) || process.env.NEXT_PUBLIC_PIPELINE_PERSONA_DEMO === "true" && member.roles.some((role) => role === "admin" || role === "assessment_coordinator");
  const directoryAvailable = canAccessSupervisorOperations(member.roles);
  if (!listsAvailable && !directoryAvailable) return null;
  return <section className={`${styles.card} ${styles.contacts}`} aria-labelledby="settings-contacts">
    <div className={styles.sectionHeader}><h2 id="settings-contacts">Contacts</h2></div>
    {listsAvailable ? <Link href="/settings/contact-lists" className={`${styles.settingRow} ${styles.contactLink}`}>
      <span className={styles.icon}><Mail size={22} aria-hidden="true" /></span>
      <span className={styles.rowText}><strong>Community contact lists</strong><span>Set the To and Cc recipients for Meet the Client.</span></span>
      <span className={styles.rowAction}>Edit recipients <ArrowRight size={18} aria-hidden="true" /></span>
    </Link> : null}
    {directoryAvailable ? <details className={styles.directory}>
      <summary className={styles.settingRow}>
        <span className={styles.icon}><BookUser size={21} aria-hidden="true" /></span>
        <span className={styles.rowText}><strong>Contact & facility directory</strong><span>Import contacts for referral forms from a spreadsheet.</span></span>
        <ChevronDown size={19} className={styles.chevron} aria-hidden="true" />
      </summary>
      <div className={styles.importer}><ContactDirectoryImport roles={member.roles} /></div>
    </details> : null}
  </section>;
}

function TextField({ label, value, maxLength, placeholder, type = "text", autoComplete, onChange }: {
  label: string; value: string | null; maxLength: number; placeholder?: string; type?: "text" | "tel"; autoComplete?: string; onChange: (value: string) => void;
}) {
  return <label className={styles.field}><span>{label}</span><input value={value ?? ""} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} placeholder={placeholder} type={type} autoComplete={autoComplete} /></label>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
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

function mergeProfileEdits(member: WorkspaceMember, latest: WorkspaceMember, form: StaffProfilePreferences) {
  const previous = profilePreferences(member);
  const next = profilePreferences(latest);
  for (const key of Object.keys(previous) as Array<keyof StaffProfilePreferences>) {
    if (form[key] !== previous[key]) next[key] = form[key];
  }
  return next;
}

function isPlainProfileClick(event: MouseEvent) {
  return !event.defaultPrevented && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

function profileSaveStatus(saving: boolean, message: string | undefined, dirty: boolean, updatedAt: string | null) {
  if (saving) return "Saving your profile…";
  if (message !== undefined) return message;
  if (dirty) return "Unsaved changes";
  return updatedAt ? `Last saved ${formatUpdatedAt(updatedAt)}` : "No unsaved changes";
}

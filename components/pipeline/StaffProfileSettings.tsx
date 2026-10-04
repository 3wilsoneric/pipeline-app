"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, BookUser, ChevronDown, LayoutDashboard, LoaderCircle, Mail, Save } from "lucide-react";

import type { StaffProfilePreferences } from "@/lib/pipeline/staff-profile";
import type { WorkspaceMember } from "@/lib/pipeline/workspace-members";
import { canAccessOperationsReports, canAccessSupervisorOperations } from "@/lib/pipeline/report-access";
import ContactDirectoryImport from "@/components/pipeline/ContactDirectoryImport";
import OutlookConnectionSetup from "./OutlookConnectionSetup";
import { useStaffProfile } from "./useStaffProfile";
import { usePersonaSwitchSave } from "@/lib/demo/persona-switch-save";
import styles from "./StaffProfileSettings.module.css";

const timeZones = [
  ["America/Los_Angeles", "Pacific time"],
  ["America/Denver", "Mountain time"],
  ["America/Chicago", "Central time"],
  ["America/New_York", "Eastern time"],
  ["UTC", "UTC"],
];

export default function StaffProfileSettings() {
  const { member, draft, loading, saving, message, controller, reload } = useStaffProfile();
  const form = draft.form;
  const conflict = Boolean(draft.conflict);
  const dirty = controller?.dirty() ?? false;
  const updateField = (field: keyof StaffProfilePreferences, value: string) => controller?.change(field, value);
  const save = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); controller?.save(); };
  usePersonaSwitchSave(async () => { await controller?.finish(); });

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
            <fieldset className={styles.fields}>
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
    <div className={styles.content}>
      <header className={styles.header}>
        <h1>Settings</h1>
        <p>Contacts, your profile, and your workspace.</p>
      </header>
      {loading ? <div className={styles.loading} role="status"><LoaderCircle size={20} className="animate-spin motion-reduce:animate-none" aria-hidden="true" /> Loading settings</div>
        : !member ? <div className={styles.card}>
          <p role="alert" className={styles.error}>{message?.text ?? "Your settings could not be loaded."}</p>
          <button className={styles.secondary} onClick={reload}>Try again</button>
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

function roleLabel(role: string) {
  if (role === "assessment_coordinator") return "Assessment coordinator";
  return role.charAt(0).toUpperCase() + role.slice(1).replaceAll("_", " ");
}

function identityLabel(status: WorkspaceMember["identity_status"]) {
  if (status === "entra_linked") return "Microsoft verified";
  if (status === "provisional") return "Pending account link";
  return "Merged account";
}

function formatUpdatedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "recently" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function profileSaveStatus(saving: boolean, message: string | undefined, dirty: boolean, updatedAt: string | null) {
  if (saving) return "Saving your profile…";
  if (message !== undefined) return message;
  if (dirty) return "Unsaved changes";
  return updatedAt ? `Last saved ${formatUpdatedAt(updatedAt)}` : "No unsaved changes";
}

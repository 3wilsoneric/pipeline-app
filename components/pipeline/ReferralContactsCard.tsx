"use client";

import { useConfirmationDialog } from "./useConfirmationDialog";

import { useEffect, useRef, useState } from "react";
import { Check, Pencil, Plus, Search, Star, Trash2, X } from "lucide-react";

import { fetchPipelineJson, PipelineApiError } from "@/lib/auth/authenticated-fetch";
import { formatPhoneForEntry } from "@/lib/pipeline/phone-display";
import {
  contactDisplayName,
  contactMethods,
  referralContactRoleLabel,
  referralContactRoles,
  type ContactInput,
  type ContactRecord,
  type ReferralContactRecord,
  type ReferralContactRole,
} from "@/lib/pipeline/contact-types";

type ContactForm = ContactInput & { role: ReferralContactRole; relationship: string; primaryForScheduling: boolean };

const emptyContactForm: ContactForm = {
  firstName: "",
  lastName: "",
  organization: "",
  jobTitle: "",
  phone: "",
  email: "",
  preferredContactMethod: "not_recorded",
  bestContactTime: "",
  notes: "",
  role: "scheduling_contact",
  relationship: "",
  primaryForScheduling: true,
};

export default function ReferralContactsCard({
  referralId,
  referrerPhone,
  referrerEmail,
}: {
  referralId?: number;
  referrerPhone: string;
  referrerEmail: string;
}) {
  const [links, setLinks] = useState<ReferralContactRecord[]>([]);
  const { confirm, confirmationDialog } = useConfirmationDialog();
  const [loading, setLoading] = useState(Boolean(referralId));
  const [mode, setMode] = useState<"closed" | "search" | "new">("closed");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ContactRecord[]>([]);
  const [form, setForm] = useState<ContactForm>(emptyContactForm);
  const [editing, setEditing] = useState<ReferralContactRecord | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const readGeneration = useRef(0);

  useEffect(() => {
    if (!referralId) {
      setLinks([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    const generation = readGeneration.current;
    setLoading(true);
    fetchPipelineJson<{ contacts: ReferralContactRecord[] }>(`/api/referrals/${referralId}/contacts`, { cache: "no-store" })
      .then((payload) => {
        if (!cancelled && generation === readGeneration.current) setLinks(payload.contacts);
      })
      .catch((reason) => {
        if (!cancelled && generation === readGeneration.current) setError(contactError(reason));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [referralId]);

  useEffect(() => {
    if (!referralId || mode !== "search") return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetchPipelineJson<{ contacts: ContactRecord[] }>(
        `/api/contacts?referral_id=${referralId}&q=${encodeURIComponent(query)}&limit=12`,
        { cache: "no-store", signal: controller.signal },
      )
        .then((payload) => setResults(payload.contacts.filter((contact) => !links.some((link) => link.contactId === contact.id))))
        .catch((reason) => {
          if (!controller.signal.aborted) setError(contactError(reason));
        });
    }, 180);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [links, mode, query, referralId]);

  const reachableContact = Boolean(referrerPhone.trim() || referrerEmail.trim());
  const schedulingContact = links.find((link) => link.primaryForScheduling && link.contact.active);
  const ready = reachableContact || Boolean(schedulingContact?.contact.phone.trim() || schedulingContact?.contact.email.trim());

  const reload = async () => {
    if (!referralId) return;
    const generation = readGeneration.current;
    const payload = await fetchPipelineJson<{ contacts: ReferralContactRecord[] }>(`/api/referrals/${referralId}/contacts`, { cache: "no-store" });
    if (generation === readGeneration.current) setLinks(payload.contacts);
  };

  const refreshAfterSave = async (savedMessage: string) => {
    const generation = readGeneration.current;
    try {
      await reload();
    } catch {
      if (generation === readGeneration.current) setError(`${savedMessage} The latest contact list could not refresh. Reload the page to check it.`);
    }
  };

  const attach = async (contact: ContactRecord) => {
    if (!referralId) return false;
    setBusy(contact.id);
    setError("");
    try {
      const saved = await fetchPipelineJson<{ record: ReferralContactRecord }>(`/api/referrals/${referralId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: contact.id,
          role: form.role,
          relationship: form.relationship,
          notes: "",
          primary_for_scheduling: form.primaryForScheduling,
          client_mutation_id: crypto.randomUUID(),
        }),
      });
      readGeneration.current += 1;
      setLinks((current) => [saved.record, ...current.filter((link) => link.id !== saved.record.id).map((link) =>
        saved.record.primaryForScheduling ? { ...link, primaryForScheduling: false } : link)]);
      closeComposer();
      await refreshAfterSave("Contact attached.");
      return true;
    } catch (reason) {
      setError(contactError(reason));
      return false;
    } finally {
      setBusy("");
    }
  };

  const createAndAttach = async () => {
    if (!referralId) return;
    setBusy("create");
    setError("");
    try {
      const created = await fetchPipelineJson<{ record: ContactRecord }>("/api/contacts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referral_id: referralId,
          contact: contactInput(form),
          client_mutation_id: crypto.randomUUID(),
        }),
      });
      if (!await attach(created.record)) {
        setMode("search");
        setQuery(contactDisplayName(created.record));
        setResults([created.record]);
        setError("Contact saved in the directory, but it was not linked to this referral. Select it below to retry the link.");
      }
    } catch (reason) {
      setError(contactError(reason));
      setBusy("");
    }
  };

  const makePrimary = async (link: ReferralContactRecord) => {
    if (!referralId || link.primaryForScheduling) return;
    setBusy(link.id);
    setError("");
    try {
      const saved = await fetchPipelineJson<{ record: ReferralContactRecord }>(`/api/referrals/${referralId}/contacts/${link.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: link.version, primary_for_scheduling: true, client_mutation_id: crypto.randomUUID() }),
      });
      readGeneration.current += 1;
      setLinks((current) => current.map((item) => item.id === link.id
        ? saved.record : { ...item, primaryForScheduling: false }));
      await refreshAfterSave("Primary scheduling contact saved.");
    } catch (reason) {
      setError(contactError(reason));
      if (reason instanceof PipelineApiError && reason.status === 409) await reload().catch(() => undefined);
    } finally {
      setBusy("");
    }
  };

  const saveContact = async () => {
    if (!referralId || !editing) return;
    setBusy(editing.id);
    setError("");
    let savedContact: ContactRecord | null = null;
    try {
      const contactResult = await fetchPipelineJson<{ record: ContactRecord }>(`/api/contacts/${editing.contactId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          referral_id: referralId,
          if_match: editing.contact.version,
          contact: contactInput(form),
          client_mutation_id: crypto.randomUUID(),
        }),
      });
      savedContact = contactResult.record;
      readGeneration.current += 1;
      setLinks((current) => current.map((link) => link.contactId === editing.contactId
        ? { ...link, contact: contactResult.record } : link));
      setEditing((current) => current?.id === editing.id ? { ...current, contact: contactResult.record } : current);
      if (
        form.role !== editing.role ||
        form.relationship !== editing.relationship ||
        form.primaryForScheduling !== editing.primaryForScheduling
      ) {
        const linkResult = await fetchPipelineJson<{ record: ReferralContactRecord }>(`/api/referrals/${referralId}/contacts/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            if_match: editing.version,
            role: form.role,
            relationship: form.relationship,
            primary_for_scheduling: form.primaryForScheduling,
            client_mutation_id: crypto.randomUUID(),
          }),
        });
        readGeneration.current += 1;
        setLinks((current) => current.map((link) => link.id === editing.id
          ? linkResult.record : linkResult.record.primaryForScheduling ? { ...link, primaryForScheduling: false } : link));
      }
      setEditing(null);
      setForm(emptyContactForm);
      await refreshAfterSave("Contact changes saved.");
    } catch (reason) {
      setError(savedContact
        ? `Contact details saved, but referral role or scheduling changes could not be saved. ${contactError(reason)}`
        : contactError(reason));
      if (reason instanceof PipelineApiError && reason.status === 409) await reload().catch(() => undefined);
    } finally {
      setBusy("");
    }
  };

  const unlink = async (link: ReferralContactRecord) => {
    if (!referralId || !await confirm({ title: "Remove this contact?", message: `${contactDisplayName(link.contact)} will be removed from this referral. The saved contact will remain in the directory.`, confirmLabel: "Remove contact", destructive: true })) return;
    setBusy(link.id);
    setError("");
    try {
      await fetchPipelineJson(`/api/referrals/${referralId}/contacts/${link.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ if_match: link.version, client_mutation_id: crypto.randomUUID() }),
      });
      readGeneration.current += 1;
      setLinks((current) => current.filter((item) => item.id !== link.id));
      await refreshAfterSave("Contact removed from this referral.");
    } catch (reason) {
      setError(contactError(reason));
      if (reason instanceof PipelineApiError && reason.status === 409) await reload().catch(() => undefined);
    } finally {
      setBusy("");
    }
  };

  const closeComposer = () => {
    setMode("closed");
    setQuery("");
    setResults([]);
    setForm(emptyContactForm);
  };

  return (
    <section aria-label="Contact and coordination" className="border border-[#d7ddd9] bg-white">
      {confirmationDialog}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#d7ddd9] bg-[#f8faf9] px-4 py-3">
        <div>
          <h3 className="text-[11px] font-black uppercase tracking-[0.08em] text-[#3f4745]">Saved contacts</h3>
          <p className="mt-1 text-[11px] text-[#68716d]">People connected to this referral. Information only—no messages are sent.</p>
        </div>
        <ContactReadinessBadge ready={ready} />
      </div>

      <ReferralContactList
        referralId={referralId}
        links={links}
        loading={loading}
        editing={editing}
        form={form}
        busy={busy}
        setEditing={setEditing}
        setForm={setForm}
        setError={setError}
        onSave={saveContact}
        onMakePrimary={makePrimary}
        onUnlink={unlink}
      />

      {error ? <p role="alert" className="border-t border-[#dce3e0] bg-[#f7faf9] px-4 py-2 text-xs font-semibold text-[#59645e]">{error}</p> : null}

      <ContactComposer
        referralId={referralId}
        mode={mode}
        query={query}
        results={results}
        form={form}
        busy={busy}
        setMode={setMode}
        setQuery={setQuery}
        setForm={setForm}
        setError={setError}
        onAttach={attach}
        onCreate={createAndAttach}
        onClose={closeComposer}
      />
    </section>
  );
}

function ContactReadinessBadge({ ready }: { ready: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-1 text-[10px] font-black uppercase tracking-[0.06em] ${ready ? "bg-[#e7f5ee] text-[#176b53]" : "bg-[#fff2df] text-[#8a5700]"}`}>
      {ready ? <Check size={12} /> : null}{ready ? "Ready to schedule" : "Contact needed"}
    </span>
  );
}

function ReferralContactList({ referralId, links, loading, editing, form, busy, setEditing, setForm, setError, onSave, onMakePrimary, onUnlink }: {
  referralId?: number;
  links: ReferralContactRecord[];
  loading: boolean;
  editing: ReferralContactRecord | null;
  form: ContactForm;
  busy: string;
  setEditing: (value: ReferralContactRecord | null) => void;
  setForm: (value: ContactForm) => void;
  setError: (value: string) => void;
  onSave: () => Promise<void>;
  onMakePrimary: (link: ReferralContactRecord) => Promise<void>;
  onUnlink: (link: ReferralContactRecord) => Promise<void>;
}) {
  return (
    <div className="divide-y divide-[#e2e6e3]">
      {loading ? <p aria-live="polite" className="px-4 py-5 text-sm text-[#68716d]">Loading saved contacts…</p> : null}
      {!loading && referralId && links.length === 0 ? <p className="px-4 py-5 text-sm text-[#68716d]">No saved contacts are connected yet.</p> : null}
      {!referralId ? <p className="px-4 py-5 text-sm text-[#68716d]">Create the workspace before adding reusable contacts.</p> : null}
      {links.map((link) => (
        <ReferralContactRow
          key={link.id}
          link={link}
          editing={editing?.id === link.id}
          form={form}
          busy={busy}
          setEditing={setEditing}
          setForm={setForm}
          setError={setError}
          onSave={onSave}
          onMakePrimary={onMakePrimary}
          onUnlink={onUnlink}
        />
      ))}
    </div>
  );
}

function ReferralContactRow({ link, editing, form, busy, setEditing, setForm, setError, onSave, onMakePrimary, onUnlink }: {
  link: ReferralContactRecord;
  editing: boolean;
  form: ContactForm;
  busy: string;
  setEditing: (value: ReferralContactRecord | null) => void;
  setForm: (value: ContactForm) => void;
  setError: (value: string) => void;
  onSave: () => Promise<void>;
  onMakePrimary: (link: ReferralContactRecord) => Promise<void>;
  onUnlink: (link: ReferralContactRecord) => Promise<void>;
}) {
  if (editing) {
    return (
      <div className="px-4 py-3">
        <ContactEditor form={form} setForm={setForm} onSave={() => void onSave()} onCancel={() => { setEditing(null); setForm(emptyContactForm); }} busy={busy === link.id} includeLinkOptions />
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-black text-[#17211d]">{contactDisplayName(link.contact)}</span>
            <span className="bg-[#eef2f0] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.06em] text-[#53605a]">{referralContactRoleLabel(link.role)}</span>
            {link.primaryForScheduling ? <span className="inline-flex items-center gap-1 bg-[#e7f5ee] px-2 py-0.5 text-[9px] font-black uppercase tracking-[0.06em] text-[#176b53]"><Star size={10} fill="currentColor" /> Scheduling</span> : null}
          </div>
          {link.contact.organization || link.contact.jobTitle ? <p className="mt-1 text-[11px] text-[#68716d]">{[link.contact.jobTitle, link.contact.organization].filter(Boolean).join(" · ")}</p> : null}
          <p className="mt-1 text-xs font-semibold text-[#3f4843]">{[link.contact.phone, link.contact.email].filter(Boolean).join(" · ") || "No phone or email recorded"}</p>
          {link.relationship ? <p className="mt-1 text-[11px] text-[#68716d]">{link.relationship}</p> : null}
        </div>
        <div className="flex items-center gap-1">
          {!link.primaryForScheduling ? <IconButton label="Set as scheduling contact" onClick={() => void onMakePrimary(link)} disabled={Boolean(busy)}><Star size={15} /></IconButton> : null}
          <IconButton label={`Edit ${contactDisplayName(link.contact)}`} onClick={() => { setEditing(link); setForm(formFromLink(link)); setError(""); }} disabled={Boolean(busy)}><Pencil size={15} /></IconButton>
          <IconButton label={`Remove ${contactDisplayName(link.contact)} from referral`} onClick={() => void onUnlink(link)} disabled={Boolean(busy)}><Trash2 size={15} /></IconButton>
        </div>
      </div>
    </div>
  );
}

function ContactComposer({ referralId, mode, query, results, form, busy, setMode, setQuery, setForm, setError, onAttach, onCreate, onClose }: {
  referralId?: number;
  mode: "closed" | "search" | "new";
  query: string;
  results: ContactRecord[];
  form: ContactForm;
  busy: string;
  setMode: (value: "closed" | "search" | "new") => void;
  setQuery: (value: string) => void;
  setForm: (value: ContactForm) => void;
  setError: (value: string) => void;
  onAttach: (contact: ContactRecord) => Promise<boolean>;
  onCreate: () => Promise<void>;
  onClose: () => void;
}) {
  if (!referralId) return null;
  if (mode === "closed") {
    return (
      <div className="flex flex-wrap gap-2 border-t border-[#d7ddd9] px-4 py-3">
        <button type="button" onClick={() => { setMode("search"); setError(""); }} className="inline-flex h-9 items-center gap-2 border border-[#bfc7c2] px-3 text-xs font-black text-[#2f3934] hover:bg-[#f4f7f5]"><Search size={14} /> Find saved contact</button>
        <button type="button" onClick={() => { setMode("new"); setError(""); }} className="inline-flex h-9 items-center gap-2 bg-[#17211d] px-3 text-xs font-black text-white hover:bg-[#26352e]"><Plus size={14} /> Add new contact</button>
      </div>
    );
  }
  return (
    <div className="border-t border-[#d7ddd9] bg-[#fbfcfb] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h4 className="text-xs font-black text-[#17211d]">{mode === "search" ? "Find a saved contact" : "Add a saved contact"}</h4>
        <IconButton label="Close contact form" onClick={onClose}><X size={16} /></IconButton>
      </div>
      {mode === "search" ? (
        <ContactSearchResults query={query} results={results} form={form} busy={busy} setQuery={setQuery} setForm={setForm} onAttach={onAttach} />
      ) : (
        <ContactEditor form={form} setForm={setForm} onSave={() => void onCreate()} onCancel={onClose} busy={busy === "create"} includeLinkOptions createMode />
      )}
    </div>
  );
}

function ContactSearchResults({ query, results, form, busy, setQuery, setForm, onAttach }: {
  query: string;
  results: ContactRecord[];
  form: ContactForm;
  busy: string;
  setQuery: (value: string) => void;
  setForm: (value: ContactForm) => void;
  onAttach: (contact: ContactRecord) => Promise<boolean>;
}) {
  return (
    <>
      <label className="block text-[10px] font-black uppercase tracking-[0.06em] text-[#53605a]">Search by name, organization, phone, or email</label>
      <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} className="mt-2 h-10 w-full border border-[#bfc7c2] bg-white px-3 text-sm outline-none focus:border-[#0f8b73]" placeholder="Start typing or browse recent contacts" />
      <ContactLinkOptions form={form} setForm={setForm} />
      <div className="mt-3 max-h-56 divide-y divide-[#e2e6e3] overflow-y-auto border border-[#d7ddd9] bg-white">
        {results.map((contact) => (
          <button key={contact.id} type="button" disabled={Boolean(busy)} onClick={() => void onAttach(contact)} className="flex w-full items-center justify-between gap-3 px-3 py-3 text-left hover:bg-[#f4f7f5] disabled:opacity-50">
            <span className="min-w-0"><span className="block truncate text-sm font-black text-[#17211d]">{contactDisplayName(contact)}</span><span className="mt-1 block truncate text-[11px] text-[#68716d]">{[contact.organization, contact.phone, contact.email].filter(Boolean).join(" · ") || "No contact details recorded"}</span></span>
            <span className="text-[10px] font-black uppercase text-[#176b53]">{busy === contact.id ? "Adding…" : "Add"}</span>
          </button>
        ))}
        {!results.length ? <p className="px-3 py-4 text-xs text-[#68716d]">No available saved contacts match.</p> : null}
      </div>
    </>
  );
}

function ContactEditor({ form, setForm, onSave, onCancel, busy, includeLinkOptions = false, createMode = false }: { form: ContactForm; setForm: (value: ContactForm) => void; onSave: () => void; onCancel: () => void; busy: boolean; includeLinkOptions?: boolean; createMode?: boolean }) {
  const field = (key: keyof ContactForm, label: string, placeholder = "") => (
    <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.06em] text-[#53605a]">{label}</span><input type={key === "phone" ? "tel" : key === "email" ? "email" : "text"} value={String(form[key])} onChange={(event) => setForm({ ...form, [key]: event.target.value })} onBlur={key === "phone" ? (event) => setForm({ ...form, phone: formatPhoneForEntry(event.target.value) }) : undefined} placeholder={placeholder} className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2.5 text-xs outline-none focus:border-[#0f8b73]" /></label>
  );
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {field("firstName", "First name")}{field("lastName", "Last name")}{field("organization", "Organization")}
        {field("jobTitle", "Role / title")}{field("phone", "Phone")}{field("email", "Email")}
        <label className="block"><span className="text-[9px] font-black uppercase tracking-[0.06em] text-[#53605a]">Preferred contact</span><select value={form.preferredContactMethod} onChange={(event) => setForm({ ...form, preferredContactMethod: event.target.value as ContactInput["preferredContactMethod"] })} className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2.5 text-xs outline-none focus:border-[#0f8b73]">{contactMethods.map((method) => <option key={method} value={method}>{method.replaceAll("_", " ")}</option>)}</select></label>
        {field("bestContactTime", "Best contact time")}{field("notes", "Contact notes")}
      </div>
      {includeLinkOptions ? <ContactLinkOptions form={form} setForm={setForm} /> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <button type="button" onClick={onSave} disabled={busy} className="h-9 bg-[#17211d] px-4 text-xs font-black text-white disabled:opacity-50">{busy ? "Saving…" : createMode ? "Save and add" : "Save contact"}</button>
        <button type="button" onClick={onCancel} disabled={busy} className="h-9 border border-[#bfc7c2] px-4 text-xs font-black text-[#2f3934]">Cancel</button>
      </div>
    </div>
  );
}

function ContactLinkOptions({ form, setForm }: { form: ContactForm; setForm: (value: ContactForm) => void }) {
  return (
    <div className="mt-3 grid gap-3 border-t border-[#e2e6e3] pt-3 sm:grid-cols-2 lg:grid-cols-[220px_minmax(0,1fr)_auto]">
      <label><span className="text-[9px] font-black uppercase tracking-[0.06em] text-[#53605a]">Connection to referral</span><select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value as ReferralContactRole })} className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2.5 text-xs outline-none focus:border-[#0f8b73]">{referralContactRoles.map((role) => <option key={role} value={role}>{referralContactRoleLabel(role)}</option>)}</select></label>
      <label><span className="text-[9px] font-black uppercase tracking-[0.06em] text-[#53605a]">Relationship note</span><input value={form.relationship} onChange={(event) => setForm({ ...form, relationship: event.target.value })} placeholder="For example: daughter, county worker" className="mt-1 h-9 w-full border border-[#c9ceca] bg-white px-2.5 text-xs outline-none focus:border-[#0f8b73]" /></label>
      <label className="flex h-9 items-center gap-2 self-end border border-[#c9ceca] bg-white px-3 text-xs font-black text-[#3f4843]"><input type="checkbox" checked={form.primaryForScheduling} onChange={(event) => setForm({ ...form, primaryForScheduling: event.target.checked })} /> Scheduling contact</label>
    </div>
  );
}

function IconButton({ label, onClick, disabled = false, children }: { label: string; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return <button type="button" aria-label={label} title={label} onClick={onClick} disabled={disabled} className="grid size-8 place-items-center text-[#53605a] hover:bg-[#eef2f0] hover:text-[#17211d] disabled:opacity-40">{children}</button>;
}

function contactInput(form: ContactForm): ContactInput {
  return {
    firstName: form.firstName,
    lastName: form.lastName,
    organization: form.organization,
    jobTitle: form.jobTitle,
    phone: form.phone,
    email: form.email,
    preferredContactMethod: form.preferredContactMethod,
    bestContactTime: form.bestContactTime,
    notes: form.notes,
  };
}

function formFromLink(link: ReferralContactRecord): ContactForm {
  return { ...contactInput({ ...emptyContactForm, ...link.contact }), role: link.role, relationship: link.relationship, primaryForScheduling: link.primaryForScheduling };
}

function contactError(reason: unknown) {
  if (reason instanceof PipelineApiError) {
    const payload = reason.payload && typeof reason.payload === "object" ? reason.payload as { error?: unknown } : null;
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
  }
  return reason instanceof Error && reason.message ? reason.message : "Contact information could not be saved.";
}

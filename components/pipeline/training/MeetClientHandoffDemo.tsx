"use client";

import { useState } from "react";
import { Check, CheckCircle2, FileText, Mail, Paperclip, Send, ShieldCheck } from "lucide-react";

type DemoPacketFile = {
  name: string;
  category: string;
  size: string;
};

const demoPacketFiles: readonly DemoPacketFile[] = [
  { name: "Referral Face Sheet.pdf", category: "Referral identity", size: "214 KB" },
  { name: "Signed Medication List.pdf", category: "Medication record", size: "386 KB" },
  { name: "LIC 602.pdf", category: "Admission document", size: "242 KB" },
  { name: "TB Test Results.pdf", category: "Health clearance", size: "96 KB" },
] as const;

const demoClient = {
  name: "Jordan Ellis",
  dateOfBirth: "Oct 12, 1982",
  community: "Santa Clarita",
  assessmentDate: "Aug 28, 2026",
  recipient: "Resident Care Director",
  recipientEmail: "resident-care-director@alamo.example",
  subject: "Meet the Client | Santa Clarita",
  introduction: [
    "Prefers a quiet introduction to new routines and clear notice before changes.",
    "Responds well to calm, direct prompts and a predictable daily schedule.",
    "Goals include attending programming and returning to community activities.",
  ],
  careSnapshot: [
    ["Mobility", "Ambulatory without an assistive device"],
    ["Daily living", "Independent with dressing; hygiene reminders help"],
    ["Communication", "Conversational; allow time when discussing changes"],
    ["Medication", "Oral medications accepted with routine reminders"],
    ["Diet", "Regular diet; no documented restrictions"],
    ["Family", "Involved by phone with the client's authorization"],
  ],
} as const;

export default function MeetClientHandoffDemo({ preparedBy }: { preparedBy: string }) {
  const [delivered, setDelivered] = useState(false);

  return (
    <section data-meet-client-demo="true" className="mt-3 overflow-hidden bg-white">
      <header className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-b border-[#dfe4e1] bg-white px-2 sm:px-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center bg-[#e9f5f1] text-[#0c806b]"><Mail size={17} /></span>
          <div>
            <h2 className="text-[15px] font-black text-[#222825]">New message</h2>
            <p className="mt-0.5 text-[11px] text-[#747d79]">Preview only</p>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] font-bold text-[#28715f]"><ShieldCheck size={15} /> Authorized care handoff</div>
      </header>

      <article aria-label="Meet the Client email preview" className="bg-white">
        <div className="px-2 sm:px-4">
          <EmailAddressRow label="From" value={`Pipeline Admissions · ${preparedBy || "Admissions"}`} />
          <EmailAddressRow label="To" value={`${demoClient.recipient} <${demoClient.recipientEmail}>`} />
          <EmailAddressRow label="Subject" value={demoClient.subject} strong />
        </div>

        <div className="mx-auto max-w-[820px] px-5 py-10 sm:px-8 sm:py-12">
          <div className="border-t-[4px] border-[#0f8b73] pt-6">
            <div className="text-[10px] font-black uppercase tracking-[0.13em] text-[#0c806b]">Pipeline Admissions</div>
            <h3 className="mt-2 text-[34px] font-black tracking-[-0.04em] text-[#17201c]">Meet the Client</h3>
            <p className="mt-1 text-[12px] font-semibold text-[#78817d]">Prepared from the signed assessment · {demoClient.assessmentDate}</p>
          </div>

          <p className="mt-8 text-[15px] leading-7 text-[#313a36]">Hello,</p>
          <p className="mt-3 text-[15px] leading-7 text-[#313a36]">Please use this brief handoff to prepare for <strong>{demoClient.name}</strong>&apos;s arrival. The reviewed admission documents are attached below.</p>

          <dl className="mt-7 grid border-y border-[#dfe3e1] py-4 sm:grid-cols-3 sm:divide-x sm:divide-[#dfe3e1]">
            <EmailFact label="Client" value={demoClient.name} />
            <EmailFact label="Date of birth" value={demoClient.dateOfBirth} />
            <EmailFact label="Community" value={demoClient.community} />
          </dl>

          <EmailSection title="What to know">
            <ul className="space-y-2.5">
              {demoClient.introduction.map((item) => <li key={item} className="grid grid-cols-[15px_minmax(0,1fr)] gap-2"><span className="font-black text-[#0f8b73]">-</span><span>{item}</span></li>)}
            </ul>
          </EmailSection>

          <EmailSection title="Care at a glance">
            <dl className="grid gap-x-9 gap-y-4 sm:grid-cols-2">
              {demoClient.careSnapshot.map(([label, value]) => (
                <div key={label} className="border-l-2 border-[#c7ddd6] pl-3">
                  <dt className="text-[9px] font-black uppercase tracking-[0.06em] text-[#5f6964]">{label}</dt>
                  <dd className="mt-1 text-[12px] leading-5 text-[#2d3632]">{value}</dd>
                </div>
              ))}
            </dl>
          </EmailSection>

          <EmailSection title="Attached admission packet">
            <div className="grid gap-2 sm:grid-cols-2">
              {demoPacketFiles.map((file) => <Attachment key={file.name} file={file} />)}
            </div>
          </EmailSection>

          <p className="mt-8 text-[14px] leading-6 text-[#313a36]">Thank you,<br /><strong>{preparedBy || "Pipeline Admissions"}</strong><br /><span className="text-[#69736e]">Admissions</span></p>
          <p className="mt-8 border-t border-[#dfe3e1] pt-4 text-[10px] leading-5 text-[#78817d]">Confidential: contains protected health information. For authorized care coordination only.</p>
        </div>
      </article>

      <footer className="flex min-h-16 flex-wrap items-center justify-between gap-3 border-y border-[#dfe3e1] bg-white px-2 py-3 sm:px-4">
        <div className="flex items-center gap-4 text-[11px] text-[#5f6964]">
          <span className="flex items-center gap-2"><Paperclip size={14} /> 4 attachments</span>
          <span className="hidden items-center gap-2 sm:flex"><Check size={13} className="text-[#0f8b73]" /> Assessment signed</span>
          <span className="hidden items-center gap-2 md:flex"><Check size={13} className="text-[#0f8b73]" /> Recipient verified</span>
        </div>
        <div className="flex items-center gap-3">
          {delivered ? <span role="status" className="text-[10px] font-black text-[#28715f]">Demo only · nothing was sent</span> : null}
          <button type="button" onClick={() => setDelivered(true)} disabled={delivered} className="flex h-10 min-w-[138px] items-center justify-center gap-2 bg-[#0f8b73] px-5 text-[10px] font-black text-white hover:bg-[#0b6d5b] disabled:bg-[#e1eee9] disabled:text-[#2a6858]">
            {delivered ? <><CheckCircle2 size={14} /> Demo delivered</> : <><Send size={13} /> Simulate delivery</>}
          </button>
        </div>
      </footer>

      {delivered ? <div className="sr-only">Demo delivery complete</div> : null}
    </section>
  );
}

function EmailAddressRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="grid min-h-12 grid-cols-[68px_minmax(0,1fr)] items-center border-b border-[#e5e8e6] text-[13px]"><span className="font-semibold text-[#727b77]">{label}</span><span className={strong ? "font-black text-[#222825]" : "font-medium text-[#37403c]"}>{value}</span></div>;
}

function EmailFact({ label, value }: { label: string; value: string }) {
  return <div className="px-0 py-2 sm:px-5 sm:py-0 first:pl-0 last:pr-0"><dt className="text-[10px] font-black uppercase tracking-[0.07em] text-[#737c78]">{label}</dt><dd className="mt-1 text-[13px] font-black text-[#222a26]">{value}</dd></div>;
}

function EmailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="mt-9"><h4 className="mb-4 text-[12px] font-black uppercase tracking-[0.07em] text-[#1f4c41]">{title}</h4><div className="text-[14px] leading-6 text-[#303936]">{children}</div></section>;
}

function Attachment({ file }: { file: DemoPacketFile }) {
  return <div className="flex min-w-0 items-center gap-3 border border-[#dce2df] bg-white px-3 py-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center bg-[#edf7f3] text-[#0f8b73]"><FileText size={17} /></span><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-black text-[#27302c]" title={file.name}>{file.name}</div><div className="mt-0.5 text-[10px] text-[#78817c]">{file.category} · {file.size}</div></div></div>;
}

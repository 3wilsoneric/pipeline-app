"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { Activity, ArrowUpRight } from "lucide-react";

// Keep the opener mounted while the optional dashboard chunk loads, so the
// shared dialog can restore keyboard focus to it on close.
const ApplicationActivityDashboard = dynamic(() => import("./ApplicationActivityDashboard"), { loading: () => null });

export default function ApplicationActivityCard() {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" aria-label="Open application activity" onClick={() => setOpen(true)} className="my-3 flex w-full items-center gap-3 rounded-lg border border-[#d7dfdb] bg-white px-4 py-3 text-left hover:bg-[#f8faf9] focus-visible:outline-2 focus-visible:outline-[#087d66]">
      <Activity size={20} aria-hidden="true" className="shrink-0 text-[#087d66]" />
      <span className="flex-1"><span className="font-semibold">Application activity</span>{" "}<span className="ml-2 text-xs text-[#53665d]">Only you</span><span className="mt-0.5 block text-sm text-[#53665d]">Who signed in, last activity, and changes across Pipeline</span></span>
      <ArrowUpRight size={18} aria-hidden="true" />
    </button>
    {open ? <ApplicationActivityDashboard onClose={() => setOpen(false)} /> : null}
  </>;
}

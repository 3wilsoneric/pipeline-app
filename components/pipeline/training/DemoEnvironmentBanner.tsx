"use client";

import Link from "next/link";
import { FlaskConical, X } from "lucide-react";
import { useSyncExternalStore } from "react";

import {
  clearPipelineDemoSession,
  hasActivePipelineDemoSession,
  PIPELINE_DEMO_SESSION_EVENT,
} from "@/lib/demo/demo-session";
import { toPipelinePath } from "@/lib/pipeline/base-path";

const deploymentIsDemo = process.env.NEXT_PUBLIC_PIPELINE_DEMO_MODE === "true";

export default function DemoEnvironmentBanner() {
  const active = useSyncExternalStore(subscribeToDemoSession, readDemoSession, () => deploymentIsDemo);

  if (!active) return null;

  return (
    <div role="status" data-pipeline-demo-banner="true" className="flex h-8 shrink-0 items-center justify-center gap-3 border-b border-[#9fc6b9] bg-[#173f35] px-3 text-white">
      <FlaskConical size={13} aria-hidden="true" />
      <span className="text-[9px] font-black uppercase tracking-[0.11em]">Demo environment · synthetic data only</span>
      <Link href={toPipelinePath("/training/demo")} className="border-l border-white/30 pl-3 text-[9px] font-black underline-offset-2 hover:underline">Demo Center</Link>
      {!deploymentIsDemo ? (
        <button type="button" aria-label="Leave demo session" onClick={() => clearPipelineDemoSession()} className="ml-1 flex h-6 w-6 items-center justify-center text-white/75 hover:bg-white/10 hover:text-white">
          <X size={12} aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
}

function subscribeToDemoSession(onChange: () => void) {
  window.addEventListener(PIPELINE_DEMO_SESSION_EVENT, onChange);
  return () => window.removeEventListener(PIPELINE_DEMO_SESSION_EVENT, onChange);
}

function readDemoSession() {
  return deploymentIsDemo || hasActivePipelineDemoSession();
}

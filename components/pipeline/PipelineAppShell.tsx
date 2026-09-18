"use client";

import { ReactNode, Suspense, useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";

import PipelineHeader from "@/components/pipeline/PipelineHeader";
import DemoEnvironmentBanner from "@/components/pipeline/training/DemoEnvironmentBanner";
import PipelineGuidedCoach from "@/components/pipeline/training/PipelineGuidedCoach";
import { PipelineShellProvider } from "@/components/pipeline/pipeline-shell-context";
import PipelinePerformanceObserver from "@/components/pipeline/PipelinePerformanceObserver";
import { useMobileViewport } from "@/components/pipeline/use-mobile-viewport";
import mobileStyles from "@/components/pipeline/PipelineMobileShell.module.css";

export default function PipelineAppShell({
  children,
}: {
  children: ReactNode;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [homeMode, setHomeMode] = useState<"welcome" | "workspace">("welcome");
  const contentRef = useRef<HTMLElement>(null);
  const beforeNavigationRef = useRef<(() => Promise<void>) | null>(null);
  const [assessmentFocused, setAssessmentFocused] = useState(false);
  const mobileViewportRef = useMobileViewport();

  return (
    <PipelineShellProvider value={{ searchTerm, setSearchTerm, searchOpen, setSearchOpen, homeMode, setHomeMode, contentRef, beforeNavigationRef, assessmentFocused, setAssessmentFocused }}>
      <div ref={mobileViewportRef} className={`${mobileStyles.shell} pipeline-surfaces flex h-dvh flex-col overflow-hidden bg-white text-[#111111]`}>
        <Suspense fallback={null}>
          <DemoEnvironmentBanner />
        </Suspense>
        <AppNavigation focused={assessmentFocused} searchOpen={searchOpen} />
        <main ref={contentRef} className="relative min-h-0 flex-1 overflow-hidden">{children}</main>
        <PipelineGuidedCoach />
        <PipelinePerformanceObserver />
      </div>
    </PipelineShellProvider>
  );
}

function AppNavigation({ focused, searchOpen }: { focused: boolean; searchOpen: boolean }) {
  const navigationRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [previousFocused, setPreviousFocused] = useState(focused);
  if (focused !== previousFocused) {
    setPreviousFocused(focused);
    setOpen(false);
  }
  const expanded = open || searchOpen;
  useEffect(() => {
    if (!focused || !open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !navigationRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismissOutside);
    return () => document.removeEventListener("pointerdown", dismissOutside);
  }, [focused, open]);
  return (
    <div ref={navigationRef} data-assessment-app-navigation={focused ? "collapsed" : "standard"} className={`relative shrink-0 ${focused ? `z-[100] ${expanded ? "" : "h-0"}` : "z-10"}`}
      onPointerEnter={(event) => { if (focused && event.pointerType === "mouse") setOpen(true); }}
      onPointerLeave={(event) => { if (focused && event.pointerType === "mouse" && !event.currentTarget.contains(document.activeElement)) setOpen(false); }}
      onFocusCapture={() => { if (focused) setOpen(true); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => { if (focused && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (event.target instanceof HTMLElement) event.target.blur(); setOpen(false); } }}>
      {focused ? <button type="button" aria-label="Show app navigation" title="App navigation" aria-expanded={expanded} aria-controls="pipeline-app-navigation" onClick={() => setOpen(true)} className={`absolute left-2 top-1.5 flex h-11 w-11 items-center justify-center rounded bg-white text-[#315d41] hover:bg-[#edf3f2] focus-visible:outline-2 focus-visible:outline-[#0f8b73] ${expanded ? "-z-10" : "z-20"}`}><ChevronDown size={16} aria-hidden="true" /></button> : null}
      {focused && !expanded ? <div data-assessment-nav-edge aria-hidden="true" className="absolute inset-x-0 top-0 h-3" /> : null}
      <div id="pipeline-app-navigation" inert={focused && !expanded} className={focused ? `inset-x-0 top-0 transition-transform duration-150 motion-reduce:transition-none ${expanded ? "relative translate-y-0 opacity-100" : "absolute pointer-events-none -translate-y-full opacity-0"}` : "relative"}>
        <Suspense fallback={<div aria-hidden="true" className="h-[68px] shrink-0 bg-white sm:h-[74px] xl:h-[82px]" />}>
          <PipelineHeader />
        </Suspense>
      </div>
    </div>
  );
}

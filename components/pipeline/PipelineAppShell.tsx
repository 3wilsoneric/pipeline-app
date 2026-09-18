"use client";

import { ReactNode, Suspense, useRef, useState } from "react";
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
  const [open, setOpen] = useState(false);
  const [previousFocused, setPreviousFocused] = useState(focused);
  if (focused !== previousFocused) {
    setPreviousFocused(focused);
    setOpen(false);
  }
  return (
    <div data-assessment-app-navigation={focused ? "collapsed" : "standard"} className={`relative shrink-0 ${focused ? "z-[100] h-3 bg-[#f7faf4]" : "z-10"}`}
      onPointerEnter={(event) => { if (focused && event.pointerType === "mouse" && window.matchMedia("(min-width: 960px) and (hover: hover) and (pointer: fine)").matches) setOpen(true); }}
      onPointerLeave={(event) => { if (focused && event.pointerType === "mouse" && window.matchMedia("(min-width: 960px) and (hover: hover) and (pointer: fine)").matches) setOpen(false); }}
      onFocusCapture={() => { if (focused) setOpen(true); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
      onKeyDown={(event) => { if (focused && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); if (event.target instanceof HTMLElement) event.target.blur(); setOpen(false); } }}>
      {focused ? <button type="button" aria-label="Show app navigation" title="App navigation" aria-expanded={open || searchOpen} aria-controls="pipeline-app-navigation" onClick={() => setOpen(true)} className="absolute right-16 top-0 z-20 flex h-6 w-11 items-center justify-center rounded-b bg-[#e1ebe0] text-[#315d41] hover:bg-[#d3e2d1] focus-visible:outline-2 focus-visible:outline-[#0f8b73]"><ChevronDown size={16} aria-hidden="true" /></button> : null}
      <div id="pipeline-app-navigation" className={focused ? `absolute inset-x-0 top-0 transition-transform duration-150 motion-reduce:transition-none focus-within:translate-y-0 focus-within:opacity-100 focus-within:pointer-events-auto ${open || searchOpen ? "translate-y-0 opacity-100" : "pointer-events-none -translate-y-full opacity-0"}` : "relative"}>
        <Suspense fallback={<div aria-hidden="true" className="h-[68px] shrink-0 bg-white sm:h-[74px] xl:h-[82px]" />}>
          <PipelineHeader />
        </Suspense>
      </div>
    </div>
  );
}

"use client";

import { ReactNode, Suspense, useCallback, useRef, useState } from "react";

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
        <div className={mobileStyles.body}>
          <AppNavigation />
          <main ref={contentRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
        </div>
        <PipelineGuidedCoach />
        <PipelinePerformanceObserver />
      </div>
    </PipelineShellProvider>
  );
}

function AppNavigation() {
  const navigationRef = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState(false);
  const closeOnMobile = useCallback(() => {
    if (window.matchMedia("(max-width: 959px)").matches) setExpanded(false);
  }, []);
  return (
    <aside ref={navigationRef} aria-label="App navigation" data-assessment-app-navigation="standard" data-sidebar-expanded={expanded} className={mobileStyles.navigation}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) closeOnMobile(); }}
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape") {
          setExpanded(false);
          navigationRef.current?.querySelector<HTMLButtonElement>("[data-navigation-toggle]")?.focus();
        }
      }}>
      {expanded ? <button type="button" aria-label="Close navigation" tabIndex={-1} onClick={() => setExpanded(false)} className={mobileStyles.backdrop} /> : null}
      <div id="pipeline-app-navigation" className={mobileStyles.navigationPanel}>
        <Suspense fallback={<div aria-hidden="true" className={mobileStyles.sidebar} />}>
          <PipelineHeader expanded={expanded} onToggle={() => setExpanded((value) => !value)} onDestinationChange={closeOnMobile} />
        </Suspense>
      </div>
    </aside>
  );
}

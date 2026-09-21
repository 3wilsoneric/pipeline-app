"use client";

import { ReactNode, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import PipelineHeader from "@/components/pipeline/PipelineHeader";
import DemoEnvironmentBanner from "@/components/pipeline/training/DemoEnvironmentBanner";
import PipelineGuidedCoach from "@/components/pipeline/training/PipelineGuidedCoach";
import { PipelineShellProvider } from "@/components/pipeline/pipeline-shell-context";
import PipelinePerformanceObserver from "@/components/pipeline/PipelinePerformanceObserver";
import { useMobileViewport } from "@/components/pipeline/use-mobile-viewport";
import mobileStyles from "@/components/pipeline/PipelineMobileShell.module.css";
import { usePhoneAssessment } from "@/components/pipeline/use-phone-layout";

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
        <div className={mobileStyles.withGuide}>
          <div className={mobileStyles.body}>
            <AppNavigation />
            <main ref={contentRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
          </div>
          <PipelineGuidedCoach />
        </div>
        <PipelinePerformanceObserver />
      </div>
    </PipelineShellProvider>
  );
}

function AppNavigation() {
  const phone = usePhoneAssessment();
  const navigationRef = useRef<HTMLElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [pinned, setPinned] = useState(false);
  const [preview, setPreview] = useState(false);
  const expanded = pinned || preview;
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const closeOnDestination = useCallback(() => {
    setPreview(false);
    if (window.matchMedia("(max-width: 959px)").matches) setPinned(false);
  }, []);
  const close = () => {
    clearTimeout(closeTimer.current);
    setPreview(false);
    setPinned(false);
  };
  if (phone) return <Suspense fallback={null}><PipelineHeader phone onDestinationChange={closeOnDestination} /></Suspense>;
  return (
    <aside ref={navigationRef} aria-label="App navigation" data-assessment-app-navigation="standard" data-sidebar-expanded={expanded} data-sidebar-pinned={pinned} className={mobileStyles.navigation}
      onPointerOver={() => clearTimeout(closeTimer.current)}
      onPointerLeave={() => {
        // A short grace period keeps the profile flyout reachable across its gap.
        closeTimer.current = setTimeout(() => {
          if (!navigationRef.current?.querySelector(":focus-visible:not([data-navigation-toggle])")) setPreview(false);
        }, 140);
      }}
      onFocusCapture={(event) => {
        if (event.target.matches(":focus-visible:not([data-navigation-toggle])")) setPreview(true);
      }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) closeOnDestination(); }}
      onKeyDown={(event) => {
        if (expanded && event.key === "Escape") {
          close();
          navigationRef.current?.querySelector<HTMLButtonElement>("[data-navigation-toggle]")?.focus();
        }
      }}>
      {expanded ? <button type="button" aria-label="Close navigation" tabIndex={-1} onClick={close} className={mobileStyles.backdrop} /> : null}
      <div id="pipeline-app-navigation" className={mobileStyles.navigationPanel}>
        <div className={mobileStyles.navigationContent} onPointerOver={(event) => {
          if (event.pointerType === "mouse" && window.matchMedia("(any-hover: hover)").matches) setPreview(true);
        }}>
          <Suspense fallback={<div aria-hidden="true" className={mobileStyles.sidebar} />}>
            <PipelineHeader onDestinationChange={closeOnDestination} />
          </Suspense>
        </div>
        <button type="button" data-navigation-toggle
          aria-label={pinned ? "Collapse navigation" : preview ? "Keep navigation expanded" : "Expand navigation"}
          title={pinned ? "Collapse navigation" : "Keep navigation expanded"}
          aria-expanded={expanded} aria-controls="pipeline-primary-navigation"
          onClick={() => { if (pinned) close(); else setPinned(true); }} className={mobileStyles.expandButton}>
          {pinned ? <ChevronLeft size={16} aria-hidden="true" /> : <ChevronRight size={16} aria-hidden="true" />}
        </button>
      </div>
    </aside>
  );
}

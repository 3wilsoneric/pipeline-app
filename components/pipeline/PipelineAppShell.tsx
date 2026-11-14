"use client";

import { ReactNode, Suspense, useEffect, useRef, useState } from "react";

import PipelineHeader from "@/components/pipeline/PipelineHeader";
import { PipelineShellProvider } from "@/components/pipeline/pipeline-shell-context";
import PipelinePerformanceObserver from "@/components/pipeline/PipelinePerformanceObserver";
import AssessorUsageObserver from "@/components/pipeline/AssessorUsageObserver";
import { useMobileViewport } from "@/components/pipeline/use-mobile-viewport";
import mobileStyles from "@/components/pipeline/PipelineMobileShell.module.css";
import { usePhoneAssessment } from "@/components/pipeline/use-phone-layout";
import { usePipelineHistoryGuard } from "@/lib/pipeline/client-navigation";
import { hasVolatileRecoveries, noteAssessmentQueueChange, retryQueuedAssessmentChanges, retryVolatileRecoveries } from "@/lib/pipeline/volatile-recovery";

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
  usePipelineHistoryGuard(beforeNavigationRef);
  const [assessmentFocused, setAssessmentFocused] = useState(false);
  const [volatileRecovery, setVolatileRecovery] = useState(false);
  const mobileViewportRef = useMobileViewport();

  useEffect(() => {
    const retry = () => { void retryVolatileRecoveries(); void retryQueuedAssessmentChanges(); };
    const onQueueChange = () => { noteAssessmentQueueChange(); retry(); };
    const update = () => setVolatileRecovery(hasVolatileRecoveries());
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasVolatileRecoveries()) return;
      event.preventDefault();
      event.returnValue = "";
    };
    const timer = window.setInterval(retry, 10_000);
    update();
    retry();
    window.addEventListener("online", retry);
    window.addEventListener("focus", retry);
    window.addEventListener("pipeline:volatile-recovery-changed", update);
    window.addEventListener("pipeline:offline-state-changed", onQueueChange);
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("online", retry);
      window.removeEventListener("focus", retry);
      window.removeEventListener("pipeline:volatile-recovery-changed", update);
      window.removeEventListener("pipeline:offline-state-changed", onQueueChange);
      window.removeEventListener("beforeunload", warnBeforeUnload);
    };
  }, []);

  return (
    <PipelineShellProvider value={{ searchTerm, setSearchTerm, searchOpen, setSearchOpen, homeMode, setHomeMode, contentRef, beforeNavigationRef, assessmentFocused, setAssessmentFocused }}>
      <div ref={mobileViewportRef} className={`${mobileStyles.shell} pipeline-surfaces flex h-dvh flex-col overflow-hidden bg-white text-[#111111]`}>
        <div className={mobileStyles.withGuide}>
          {volatileRecovery ? <div role="alert" className="border-b border-[#a4473c] bg-[#fff4ee] px-4 py-2 text-center text-sm font-semibold text-[#83382f]">Some edits are only in this open tab. Keep it open while Pipeline retries saving them.</div> : null}
          <div className={mobileStyles.body}>
            <AppNavigation />
            <main ref={contentRef} className="relative min-h-0 min-w-0 flex-1 overflow-hidden">{children}</main>
          </div>
        </div>
        <PipelinePerformanceObserver />
        <AssessorUsageObserver />
      </div>
    </PipelineShellProvider>
  );
}

function AppNavigation() {
  const phone = usePhoneAssessment();
  if (phone) return <Suspense fallback={null}><PipelineHeader phone /></Suspense>;
  return (
    <aside aria-label="App navigation" data-assessment-app-navigation="standard" className={mobileStyles.navigation}>
      <div id="pipeline-app-navigation" className={mobileStyles.navigationPanel}>
        <div className={mobileStyles.navigationContent}>
          <Suspense fallback={<div aria-hidden="true" className={mobileStyles.sidebar} />}>
            <PipelineHeader />
          </Suspense>
        </div>
      </div>
    </aside>
  );
}

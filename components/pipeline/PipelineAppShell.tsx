"use client";

import { ReactNode, Suspense, useState } from "react";

import PipelineHeader from "@/components/pipeline/PipelineHeader";
import DemoEnvironmentBanner from "@/components/pipeline/training/DemoEnvironmentBanner";
import PipelineGuidedCoach from "@/components/pipeline/training/PipelineGuidedCoach";
import { PipelineShellProvider } from "@/components/pipeline/pipeline-shell-context";

export default function PipelineAppShell({
  children,
}: {
  children: ReactNode;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [homeMode, setHomeMode] = useState<"welcome" | "workspace">("welcome");

  return (
    <PipelineShellProvider value={{ searchTerm, setSearchTerm, searchOpen, setSearchOpen, homeMode, setHomeMode }}>
      <div className="flex h-screen flex-col overflow-hidden bg-white text-[#111111]">
        <DemoEnvironmentBanner />
        <Suspense fallback={<div aria-hidden="true" className="h-[68px] shrink-0 bg-white sm:h-[74px] xl:h-[82px]" />}>
          <PipelineHeader />
        </Suspense>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
        <PipelineGuidedCoach />
      </div>
    </PipelineShellProvider>
  );
}

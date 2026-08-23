"use client";

import { ReactNode, Suspense, useState } from "react";

import PipelineHeader from "@/components/pipeline/PipelineHeader";
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
        <Suspense fallback={<div aria-hidden="true" className="h-[82px] shrink-0 bg-white" />}>
          <PipelineHeader />
        </Suspense>
        <main className="min-h-0 flex-1 overflow-hidden">{children}</main>
      </div>
    </PipelineShellProvider>
  );
}

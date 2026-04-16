"use client";

import { ReactNode, useState } from "react";
import { usePathname } from "next/navigation";

import NewReferralModal from "@/components/pipeline/NewReferralModal";
import PipelineHeader from "@/components/pipeline/PipelineHeader";
import PipelineSidebar from "@/components/pipeline/PipelineSidebar";
import { PipelineShellProvider } from "@/components/pipeline/pipeline-shell-context";

export default function PipelineAppShell({
  children,
}: {
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [searchTerm, setSearchTerm] = useState("");
  const [isNewReferralOpen, setIsNewReferralOpen] = useState(false);

  return (
    <div className="flex min-h-screen bg-transparent text-slate-900">
      <PipelineSidebar onNewReferral={() => setIsNewReferralOpen(true)} />
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <PipelineHeader
          pathname={pathname}
          searchTerm={searchTerm}
          onSearchChange={setSearchTerm}
        />
        <PipelineShellProvider value={{ searchTerm, setSearchTerm }}>
          <main className="flex-1 overflow-hidden px-4 py-4">
            <div className="h-full overflow-hidden rounded-[20px] border border-slate-200 bg-[#f8faf8]">
              {children}
            </div>
          </main>
        </PipelineShellProvider>
      </div>
      <NewReferralModal
        isOpen={isNewReferralOpen}
        onClose={() => setIsNewReferralOpen(false)}
        onSubmit={() => setIsNewReferralOpen(false)}
      />
    </div>
  );
}

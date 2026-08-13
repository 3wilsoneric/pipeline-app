"use client";

import { createContext, useContext } from "react";

type PipelineShellContextValue = {
  searchTerm: string;
  setSearchTerm: (value: string) => void;
  searchOpen: boolean;
  setSearchOpen: (value: boolean | ((current: boolean) => boolean)) => void;
  homeMode: "welcome" | "workspace";
  setHomeMode: (value: "welcome" | "workspace") => void;
};

const PipelineShellContext = createContext<PipelineShellContextValue | null>(
  null,
);

export function PipelineShellProvider({
  children,
  value,
}: {
  children: React.ReactNode;
  value: PipelineShellContextValue;
}) {
  return (
    <PipelineShellContext.Provider value={value}>
      {children}
    </PipelineShellContext.Provider>
  );
}

export function usePipelineShell() {
  const context = useContext(PipelineShellContext);

  if (!context) {
    throw new Error("usePipelineShell must be used inside PipelineShellProvider");
  }

  return context;
}

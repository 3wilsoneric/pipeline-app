"use client";

import { ListTodo } from "lucide-react";

export default function AssignedWorkButton({ onOpen, disabled = false }: {
  onOpen: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label="Workspaces"
      title="Workspaces"
      onClick={onOpen}
      disabled={disabled}
      className="flex h-10 shrink-0 items-center justify-center gap-2 px-2 text-[11px] font-bold text-[#176f60] outline-none hover:bg-[#eff8f5] focus-visible:ring-2 focus-visible:ring-[#0f8b73] disabled:cursor-wait disabled:opacity-40 sm:px-3"
    >
      <ListTodo size={17} aria-hidden="true" />
      <span className="hidden sm:inline">Workspaces</span>
    </button>
  );
}

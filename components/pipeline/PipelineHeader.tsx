import Link from "next/link";
import { MessageSquareMore, Search } from "lucide-react";
import UserAvatar from "@/components/pipeline/UserAvatar";

interface PipelineHeaderProps {
  pathname: string;
  searchTerm: string;
  onSearchChange: (value: string) => void;
}

type RouteCopy = {
  title: string;
  placeholder: string;
  actionLabel?: string;
  actionHref?: string;
};

export default function PipelineHeader({
  pathname,
  searchTerm,
  onSearchChange,
}: PipelineHeaderProps) {
  const routeCopy = {
    "/": {
      title: "Overview",
      placeholder: "Search people, packets, communities...",
      actionLabel: "New intake",
      actionHref: "/referrals",
    },
    "/referrals": {
      title: "Intake",
      placeholder: "Search intake queue...",
      actionLabel: "New intake",
      actionHref: "/referrals",
    },
    "/assessments": {
      title: "Packets",
      placeholder: "Search packets, clinicians, locations...",
    },
    "/communities": {
      title: "Communities",
      placeholder: "Search communities and counties...",
      actionLabel: "New intake",
      actionHref: "/referrals",
    },
    "/settings": {
      title: "Settings",
      placeholder: "Search settings...",
    },
  } satisfies Record<string, RouteCopy>;

  const current: RouteCopy =
    routeCopy[pathname as keyof typeof routeCopy] ?? routeCopy["/"];

  return (
    <header className="border-b border-slate-200 bg-white/95 px-4 py-2.5 backdrop-blur">
      <div className="flex flex-col gap-2.5 xl:flex-row xl:items-center xl:justify-between">
        <div className="min-w-0">
          <h1 className="text-[14px] font-medium tracking-[-0.02em] text-slate-950">
            {current.title}
          </h1>
        </div>

        <div className="grid gap-2 md:grid-cols-[minmax(0,260px)_auto_auto_auto] md:items-center xl:min-w-[580px]">
          <div className="relative min-w-0">
            <Search
              size={14}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              type="text"
              placeholder={current.placeholder}
              value={searchTerm}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-9 w-full rounded-xl border border-slate-200 bg-slate-50 pl-9 pr-3 text-[12px] text-slate-700 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-200 focus:bg-white focus:ring-2 focus:ring-indigo-50"
            />
          </div>

          <Link
            href="/chat"
            aria-label="Open Pipeline chat"
            className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-indigo-200 bg-indigo-50/35 text-slate-700 transition-colors hover:bg-indigo-50/60"
          >
            <MessageSquareMore size={15} className="text-indigo-700" />
          </Link>

          {current.actionHref && current.actionLabel ? (
            <Link
              href={current.actionHref}
              className="app-gradient-button inline-flex h-9 items-center justify-center rounded-xl px-3.5 text-[12px] font-medium transition-all"
            >
              {current.actionLabel}
            </Link>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-2.5 py-1">
            <div className="min-w-0 text-right">
              <div className="text-[12px] font-medium text-slate-900">
                Andrew Dominici
              </div>
              <div className="text-[11px] text-slate-500">
                Program Integrity
              </div>
            </div>
            <UserAvatar size="sm" />
          </div>
        </div>
      </div>
    </header>
  );
}

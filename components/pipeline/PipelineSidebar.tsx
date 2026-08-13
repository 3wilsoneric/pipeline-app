"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import {
  BarChart3,
  CalendarDays,
  ChevronDown,
  Clock3,
  Database,
  FileText,
  FolderKanban,
  Home,
  LayoutGrid,
  LayoutTemplate,
  MapPin,
  Share2,
  Trash2,
} from "lucide-react";
import { pipelineSidebarCommunities as communityViews } from "@/lib/pipeline/community-config";

const mainNav = [
  { icon: Home, label: "Home", href: "/", view: "home" },
  { icon: FolderKanban, label: "Projects", href: "/?view=referrals", view: "referrals" },
  { icon: CalendarDays, label: "Calendar", href: "/?view=calendar", view: "calendar" },
];

const workspaceNav = [
  { icon: LayoutGrid, label: "All canvases", href: "/?view=canvases", view: "canvases" },
  { icon: FileText, label: "Files", href: "/?view=files", view: "files" },
  { icon: Database, label: "Packet ingestion", href: "/?view=ingestion", view: "ingestion" },
  { icon: LayoutTemplate, label: "Canvas templates", href: "/?view=templates", view: "templates" },
  { icon: Share2, label: "Shared with me", href: "/?view=shared", view: "shared" },
  { icon: Trash2, label: "Trash", href: "/?view=trash", view: "trash" },
];

const reportViews = [
  { label: "Assessment worklist", report: "assessment-dashboard" },
  { label: "EHR export queue", report: "ehr-upload" },
  { label: "Referral Pipeline", report: "pipeline" },
  { label: "Community Census", report: "census" },
];

const monthViews = [
  { label: "July 2026", month: "2026-07" },
  { label: "June 2026", month: "2026-06" },
  { label: "May 2026", month: "2026-05" },
];

export default function PipelineSidebar() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = searchParams.get("view") ?? "home";
  const selectedCommunity = searchParams.get("community");
  const selectedMonth = searchParams.get("month") ?? "2026-07";
  const selectedReport = searchParams.get("report") ?? "ehr-upload";
  const [openMonths, setOpenMonths] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(monthViews.map((month) => [month.month, true])),
  );
  const [isReportsOpen, setIsReportsOpen] = useState(view === "reports");

  const toggleMonth = (month: string) => {
    setOpenMonths((current) => ({
      ...current,
      [month]: !current[month],
    }));
  };

  return (
    <aside className="flex w-[250px] shrink-0 flex-col overflow-y-auto border-r border-[#d9d9dc] bg-[#f0f2f2] px-3 py-3">
      <div className="mb-5 px-1">
        <div className="min-w-0">
          <div className="truncate text-[22px] font-black uppercase leading-none tracking-[0.08em] text-[#2d7257]">
            Pipeline
          </div>
        </div>
      </div>

      <nav className="space-y-1">
        {mainNav.map((item) => {
          const Icon = item.icon;
          const isActive =
            pathname === "/" && item.view === view;

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${
                isActive
                  ? "bg-[#d5dcda] text-[#202022]"
                  : "text-[#303034] hover:bg-[#dededf]"
              }`}
            >
              <Icon size={19} />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-1">
        <button
          onClick={() => setIsReportsOpen((current) => !current)}
          className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${
            view === "reports"
              ? "bg-[#d5dcda] text-[#202022]"
              : "text-[#303034] hover:bg-[#dededf]"
          }`}
        >
          <BarChart3 size={19} />
          Reports
          <ChevronDown
            size={16}
            className={`ml-auto transition-transform ${isReportsOpen ? "" : "-rotate-90"}`}
          />
        </button>

        {isReportsOpen ? (
          <div className="mt-1 space-y-1 pl-8">
            {reportViews.map((report) => (
              <Link
                key={report.report}
                href={`/?view=reports&report=${report.report}`}
                className={`block rounded-md px-3 py-2 text-[13px] font-semibold transition-colors ${
                  selectedReport === report.report
                    ? "bg-white text-[#202022]"
                    : "text-[#5f686a] hover:bg-[#dededf]"
                }`}
              >
                {report.label}
              </Link>
            ))}
          </div>
        ) : null}
      </div>

      <div className="my-4 h-px bg-[#d5d5d7]" />

      <div className="space-y-1">
        {workspaceNav.map((item) => {
          const Icon = item.icon;
          const isActive = pathname === "/" && item.view === view;

          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${
                isActive
                  ? "bg-white text-[#202022] shadow-sm"
                  : "text-[#303034] hover:bg-[#dededf]"
              }`}
            >
              <Icon size={18} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="my-4 h-px bg-[#d5d5d7]" />

      <div className="space-y-1">
        <Link
          href="/?view=referrals"
          className={`flex h-10 items-center gap-3 rounded-lg px-3 text-[15px] font-medium transition-colors ${
            view === "referrals"
              ? "bg-[#d5dcda] text-[#202022]"
              : "text-[#303034] hover:bg-[#dededf]"
          }`}
        >
          <Clock3 size={18} />
          Recent
        </Link>

        <div className="pt-2 text-[11px] font-black uppercase tracking-[0.08em] text-[#7c8385]">
          Referral folders
        </div>

        <div className="space-y-1">
          {monthViews.map((month) => {
            const isMonthActive =
              view === "month" &&
              selectedMonth === month.month &&
              !selectedCommunity;
            const isOpen = openMonths[month.month] ?? false;

            return (
              <div key={month.month}>
                <div className="flex items-center gap-1">
                  <Link
                    href={`/?view=month&month=${month.month}`}
                    className={`flex h-9 min-w-0 flex-1 items-center gap-3 rounded-lg px-3 text-[14px] font-medium transition-colors ${
                      isMonthActive
                        ? "bg-[#d5dcda] text-[#202022]"
                        : "text-[#303034] hover:bg-[#dededf]"
                    }`}
                  >
                    <CalendarDays size={17} />
                    <span className="truncate">{month.label}</span>
                  </Link>
                  <button
                    type="button"
                    onClick={() => toggleMonth(month.month)}
                    aria-label={`${isOpen ? "Collapse" : "Expand"} ${month.label}`}
                    className="flex h-9 w-8 shrink-0 items-center justify-center rounded-lg text-[#6b7476] transition-colors hover:bg-[#dededf] hover:text-[#202022]"
                  >
                    <ChevronDown
                      size={16}
                      className={`transition-transform ${isOpen ? "" : "-rotate-90"}`}
                    />
                  </button>
                </div>

                {isOpen ? (
                  <div className="mt-1 space-y-1 pl-5">
                    {communityViews.map((community) => (
                      <Link
                        key={`${month.month}-${community.name}`}
                        href={`/?view=month&month=${month.month}&community=${encodeURIComponent(community.name)}`}
                        className={`flex h-8 items-center gap-2 rounded-md px-2.5 text-[13px] font-semibold transition-colors ${
                          view === "month" &&
                          selectedMonth === month.month &&
                          selectedCommunity === community.name
                            ? "bg-white text-[#202022] shadow-sm"
                            : "text-[#5f686a] hover:bg-[#dededf]"
                        }`}
                      >
                        <span
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded ${community.color}`}
                        >
                          <MapPin size={12} className="text-white" />
                        </span>
                        <span className="truncate">{community.name}</span>
                      </Link>
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="mt-auto border-t border-[#d5d5d7] px-3 pt-3 text-[11px] font-semibold leading-5 text-[#7c8385]">
        Referral canvases are shared working records. Reports are downstream
        views of the same centralized data.
      </div>
    </aside>
  );
}

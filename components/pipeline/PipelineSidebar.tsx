"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Plus,
  LayoutGrid,
  Users,
  ClipboardCheck,
  MapPin,
  Settings,
} from "lucide-react";
import UserAvatar from "@/components/pipeline/UserAvatar";

interface PipelineSideBarProps {
  onNewReferral?: () => void;
}

const PipelineSideBar: React.FC<PipelineSideBarProps> = ({ onNewReferral }) => {
  const pathname = usePathname();

  const navItems = [
    { icon: LayoutGrid, label: "Overview", path: "/" },
    { icon: Users, label: "Intake", path: "/referrals", count: 8 },
    { icon: ClipboardCheck, label: "Packets", path: "/assessments", count: 3 },
    { icon: MapPin, label: "Communities", path: "/communities" },
    { icon: Settings, label: "Settings", path: "/settings" },
  ];

  return (
    <aside className="flex w-[244px] shrink-0 flex-col border-r border-slate-200 bg-[#fcfdfc] px-4 py-4">
      <div className="mb-6 px-2 pt-1">
        <Link href="/" className="block">
          <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-center">
            <div className="text-[1.32rem] font-bold tracking-[-0.05em] text-slate-950">
              Pipeline
            </div>
          </div>
        </Link>
      </div>

      <div className="mb-5 rounded-2xl border border-slate-200 bg-white p-2">
        <button
          onClick={onNewReferral}
          className="app-gradient-button flex h-9 w-full items-center justify-center gap-2 rounded-xl px-3 text-[12px] font-medium transition-all"
        >
          <Plus size={14} />
          New Intake
        </button>
      </div>

      <nav className="flex-1">
        <div className="space-y-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.path;

            return (
              <Link
                key={item.path}
                href={item.path}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-[13px] leading-5 transition-colors ${
                  isActive
                    ? "border-indigo-200 bg-indigo-50/50 text-slate-950"
                    : "border-transparent text-slate-700 hover:border-slate-200 hover:bg-white"
                }`}
              >
                <div className={isActive ? "text-indigo-700" : "text-slate-400"}>
                  <Icon size={15} />
                </div>
                <span className={isActive ? "font-medium" : "font-normal"}>
                  {item.label}
                </span>
                {"count" in item ? (
                  <span
                    className={`ml-auto rounded-full px-2 py-0.5 text-[11px] font-medium ${
                      isActive
                        ? "bg-indigo-100 text-indigo-800"
                        : "bg-slate-100 text-slate-500"
                    }`}
                  >
                    {item.count}
                  </span>
                ) : isActive ? (
                  <span className="ml-auto h-2 w-2 rounded-full bg-indigo-500" />
                ) : null}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center gap-3">
          <UserAvatar size="md" />
          <div className="min-w-0">
            <div className="truncate text-[12px] font-medium text-slate-900">
              Andrew Dominici
            </div>
            <div className="truncate text-[11px] text-slate-500">
              Chief Program Integrity Officer
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};

export default PipelineSideBar;

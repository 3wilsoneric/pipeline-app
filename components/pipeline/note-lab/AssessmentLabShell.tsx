import Link from "next/link";
import type { ReactNode } from "react";

import { toPipelinePath } from "@/lib/pipeline/base-path";

export default function AssessmentLabShell({
  children,
  active,
  showLanguageLab,
}: {
  children: ReactNode;
  active: "language" | "practice";
  showLanguageLab: boolean;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-[#f4f6f5]">
      <header className="shrink-0 border-b border-[#d5ddda] bg-white px-3 sm:px-6">
        <div className="mx-auto flex h-14 max-w-[1380px] items-center justify-between gap-4">
          <div className="text-[12px] font-black text-[#26302b]">Assessment lab</div>
          <nav aria-label="Assessment lab" className="flex h-full items-center gap-5 text-[10px] font-black">
            <Link
              href={toPipelinePath("/note-lab/practice")}
              aria-current={active === "practice" ? "page" : undefined}
              className={`flex h-full items-center border-b-2 px-1 outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 ${active === "practice" ? "border-[#0f8b73] text-[#0b705f]" : "border-transparent text-[#68736e] hover:text-[#27312c]"}`}
            >
              Practice assessment
            </Link>
            {showLanguageLab ? (
              <Link
                href={toPipelinePath("/note-lab")}
                aria-current={active === "language" ? "page" : undefined}
                className={`flex h-full items-center border-b-2 px-1 outline-none focus-visible:ring-2 focus-visible:ring-[#0f8b73] focus-visible:ring-offset-2 ${active === "language" ? "border-[#0f8b73] text-[#0b705f]" : "border-transparent text-[#68736e] hover:text-[#27312c]"}`}
              >
                Language lab
              </Link>
            ) : null}
          </nav>
        </div>
      </header>
      <div className="min-h-0 flex-1">{children}</div>
    </div>
  );
}

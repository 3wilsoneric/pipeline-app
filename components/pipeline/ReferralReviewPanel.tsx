"use client";

import { ArrowRight, Check, Circle } from "lucide-react";

import ReferralActivityPanel from "@/components/pipeline/ReferralActivityPanel";
import {
  AdmissionDecisionEditor,
  EhrHandoffEditor,
} from "@/components/pipeline/ReferralDecisionEditors";
import ReferralRequirementsEditor from "@/components/pipeline/ReferralRequirementsEditor";
import {
  isReviewItemComplete,
  summarizeReviewSections,
  type ReviewSection,
  type ReviewStep,
} from "@/lib/pipeline/referral-review";
import type { Referral } from "@/lib/pipeline/referral-types";

export default function ReferralReviewPanel({
  clientName,
  referral,
  assessmentComplete,
  sections,
  complete,
  total,
  percent,
  onOpenStep,
  onDecisionSaved,
}: {
  clientName: string;
  referral: Referral | null;
  assessmentComplete: boolean;
  sections: ReviewSection[];
  complete: number;
  total: number;
  percent: number;
  onOpenStep: (page: ReviewStep) => void;
  onDecisionSaved: (referral: Referral) => void | Promise<void>;
}) {
  const sectionCounts = new Map(
    summarizeReviewSections(sections).sections.map((section) => [section.label, section]),
  );

  return (
    <section aria-label="Review" className="py-1 sm:px-2 sm:py-2">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d9d9d9] pb-3">
        <h2 className="text-[18px] font-black text-[#111111]">{clientName.trim() || "Unnamed client"}</h2>
        <div className="min-w-[180px]">
          <div className="flex items-baseline justify-between gap-3 text-[11px]">
            <span className="font-black text-[#111111]">{complete} of {total} items present</span>
            <span className="font-black text-[#0c705f]">{percent}%</span>
          </div>
          <div
            role="progressbar"
            aria-label="Referral data completion"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            className="mt-2 h-2 bg-[#e4e8e3]"
          >
            <div className="h-full bg-[#0f8b73] transition-all" style={{ width: `${percent}%` }} />
          </div>
        </div>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        {sections.map((section) => {
          const sectionSummary = sectionCounts.get(section.label);
          const sectionComplete = sectionSummary?.complete ?? 0;
          return (
            <section key={section.label} className="border border-[#d9d9d9] bg-white">
              <div className="flex items-center justify-between border-b border-[#d9d9d9] px-4 py-3">
                <h3 className="text-[12px] font-black uppercase tracking-[0.1em] text-[#111111]">{section.label}</h3>
                <span className="text-[11px] font-black text-[#0c705f]">{sectionComplete}/{section.items.length}</span>
              </div>
              <div className="divide-y divide-[#eeeeee]">
                {section.items.map((item) => {
                  const present = isReviewItemComplete(item);
                  const displayValue = present ? (item.sensitive ? "Entered" : item.value.trim()) : "Not entered";
                  return (
                    <button
                      key={item.label}
                      type="button"
                      onClick={() => onOpenStep(item.step)}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-[#f7faf9]"
                    >
                      <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${present ? "border-[#0f8b73] bg-[#0f8b73] text-white" : "border-[#b98b1c] text-[#b98b1c]"}`}>
                        {present ? <Check size={12} /> : <Circle size={8} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-black text-[#111111]">{item.label}</span>
                        <span className={`mt-0.5 block truncate text-[11px] ${present ? "text-[#595959]" : "text-[#8a5a10]"}`}>{displayValue}</span>
                      </span>
                      <ArrowRight aria-hidden="true" size={14} className="shrink-0 text-[#0c705f]" />
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
      <ReferralRequirementsEditor referral={referral} onReferralUpdated={onDecisionSaved} />
      <AdmissionDecisionEditor referral={referral} assessmentComplete={assessmentComplete} onSaved={onDecisionSaved} />
      <EhrHandoffEditor referral={referral} onSaved={onDecisionSaved} />
      <ReferralActivityPanel referralId={referral?.id} version={referral?.version} />
    </section>
  );
}

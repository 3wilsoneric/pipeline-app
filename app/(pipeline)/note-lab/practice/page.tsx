import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import AssessmentLabShell from "@/components/pipeline/note-lab/AssessmentLabShell";
import AssessmentPracticeWorkspace from "@/components/pipeline/note-lab/AssessmentPracticeWorkspace";
import { canReviewAssessmentLanguage, getAssessmentPracticeUser } from "@/lib/note-lab/note-lab-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Practice Assessment | Pipeline",
  description: "Synthetic Pipeline assessment practice.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AssessmentPracticePage() {
  const user = await getAssessmentPracticeUser(new Headers(await headers()));
  if (!user) notFound();
  return (
    <AssessmentLabShell active="practice" showLanguageLab={canReviewAssessmentLanguage(user)}>
      <AssessmentPracticeWorkspace traineeName={firstName(user.name)} />
    </AssessmentLabShell>
  );
}

function firstName(displayName: string) {
  const naturalOrder = displayName.includes(",") ? displayName.split(",").slice(1).join(",").trim() : displayName.trim();
  return naturalOrder.split(/\s+/).find(Boolean) ?? "Assessor";
}

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import AssessmentPracticeWorkspace from "@/components/pipeline/note-lab/AssessmentPracticeWorkspace";
import { getAssessmentPracticeUser } from "@/lib/note-lab/note-lab-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Practice Assessment | Pipeline",
  description: "Synthetic Pipeline assessment practice.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AssessmentPracticePage() {
  const user = await getAssessmentPracticeUser(new Headers(await headers()));
  if (!user) notFound();
  return <AssessmentPracticeWorkspace traineeId={user.id} traineeName={firstName(user.name)} />;
}

function firstName(displayName: string) {
  const naturalOrder = displayName.includes(",") ? displayName.split(",").slice(1).join(",").trim() : displayName.trim();
  return naturalOrder.split(/\s+/).find(Boolean) ?? "Assessor";
}

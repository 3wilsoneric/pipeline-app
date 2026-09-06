import type { Metadata } from "next";
import { notFound } from "next/navigation";

import AssessmentPracticeWorkspace from "@/components/pipeline/note-lab/AssessmentPracticeWorkspace";
import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";
import { getAssessmentPracticeUser } from "@/lib/note-lab/note-lab-access";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Practice Assessment | AHS - Pipeline",
  description: "Synthetic Pipeline assessment practice.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AssessmentPracticePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const source = (await searchParams).from;
  const user = await getAssessmentPracticeUser(await getServerComponentRequestHeaders());
  if (!user) notFound();
  return (
    <AssessmentPracticeWorkspace
      traineeId={user.id}
      traineeName={firstName(user.name)}
      returnToPresentation={source === "demo"}
    />
  );
}

function firstName(displayName: string) {
  const naturalOrder = displayName.includes(",") ? displayName.split(",").slice(1).join(",").trim() : displayName.trim();
  return naturalOrder.split(/\s+/).find(Boolean) ?? "Assessor";
}

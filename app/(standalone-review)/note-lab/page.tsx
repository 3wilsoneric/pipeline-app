import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";
import { getAssessmentPracticeUser } from "@/lib/note-lab/note-lab-access";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Practice Assessment | AHS - Pipeline",
  description: "Synthetic Pipeline assessment practice.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function NoteLabPage() {
  const user = await getAssessmentPracticeUser(await getServerComponentRequestHeaders());
  if (!user) notFound();
  redirect(toPipelinePath("/note-lab/practice"));
}

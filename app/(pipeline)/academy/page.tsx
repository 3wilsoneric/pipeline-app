import { createHash } from "node:crypto";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import PipelineDeveloperAcademy from "@/components/pipeline/PipelineDeveloperAcademy";
import { getDeveloperAcademyOwner } from "@/lib/academy/academy-access";
import { emptyAcademyProgress, type AcademyProgressRecord } from "@/lib/academy/academy-progress-contract";
import { getAcademyProgressRecord } from "@/lib/academy/academy-progress-store";

export const metadata: Metadata = {
  title: "Developer Academy | Pipeline",
  description: "Private, source-grounded Pipeline developer curriculum.",
  robots: {
    index: false,
    follow: false,
    nocache: true,
  },
};

export default async function AcademyPage() {
  const owner = await getDeveloperAcademyOwner(new Headers(await headers()));
  if (!owner) notFound();

  const progressIdentity = createHash("sha256")
    .update(owner.id)
    .digest("hex")
    .slice(0, 16);
  const initialProgress = await safeInitialProgress(owner.id);

  return (
    <PipelineDeveloperAcademy
      learnerName={firstName(owner.name)}
      progressStorageKey={`pipeline-developer-academy:${progressIdentity}`}
      initialProgress={initialProgress}
    />
  );
}

async function safeInitialProgress(ownerId: string): Promise<AcademyProgressRecord> {
  try {
    return await getAcademyProgressRecord(ownerId);
  } catch {
    return {
      revision: 0,
      progress: emptyAcademyProgress(),
      updatedAt: null,
      persistence: "browser",
    };
  }
}

function firstName(displayName: string) {
  const naturalOrder = displayName.includes(",")
    ? displayName.split(",").slice(1).join(",").trim()
    : displayName.trim();
  return naturalOrder.split(/\s+/).find(Boolean) ?? "Developer";
}

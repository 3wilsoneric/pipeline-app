import { createHash } from "node:crypto";

import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import PipelineOperatorAcademy from "@/components/pipeline/PipelineOperatorAcademy";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { primaryOperatorRole } from "@/lib/training/operator-training-curriculum";
import { getOperatorTrainingUser } from "@/lib/training/operator-training-access";
import { emptyOperatorProgress, type OperatorProgressRecord } from "@/lib/training/operator-training-progress-contract";
import { getOperatorProgressRecord } from "@/lib/training/operator-training-progress-store";

export const metadata: Metadata = {
  title: "Learning Center | Pipeline",
  description: "Role-based Pipeline workflow training and certification.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TrainingPage() {
  const user = await getOperatorTrainingUser(new Headers(await headers()));
  if (!user) notFound();
  const role = primaryOperatorRole(user.roles);
  const identity = createHash("sha256").update(user.id).digest("hex").slice(0, 16);
  const initialProgress = await safeInitialProgress(user.id, user.roles, role);
  const demoEnvironment = getPipelineDemoEnvironment();
  return <PipelineOperatorAcademy learnerName={firstName(user.name)} assignedRoles={user.roles} progressStorageKey={`pipeline-operator-training:${identity}`} initialProgress={initialProgress} demoUrl={demoEnvironment.entryUrl} />;
}

async function safeInitialProgress(principalId: string, roles: readonly string[], role: ReturnType<typeof primaryOperatorRole>): Promise<OperatorProgressRecord> {
  try {
    return await getOperatorProgressRecord(principalId, roles, role);
  } catch {
    return { revision: 0, progress: emptyOperatorProgress(role), updatedAt: null, persistence: "browser" };
  }
}

function firstName(displayName: string) {
  const naturalOrder = displayName.includes(",") ? displayName.split(",").slice(1).join(",").trim() : displayName.trim();
  return naturalOrder.split(/\s+/).find(Boolean) ?? "Team member";
}

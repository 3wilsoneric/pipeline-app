import { createHash } from "node:crypto";

import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PipelineOperatorAcademy from "@/components/pipeline/PipelineOperatorAcademy";
import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";
import { primaryOperatorRole } from "@/lib/training/operator-training-curriculum";
import { getOperatorTrainingUser } from "@/lib/training/operator-training-access";
import { emptyOperatorProgress, type OperatorProgressRecord } from "@/lib/training/operator-training-progress-contract";
import { getOperatorProgressRecord } from "@/lib/training/operator-training-progress-store";

export const metadata: Metadata = {
  title: "Learning Center | AHS - Pipeline",
  description: "Guided walkthroughs for common Pipeline workflows.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function TrainingPage() {
  const user = await getOperatorTrainingUser(await getServerComponentRequestHeaders());
  if (!user) notFound();
  const role = primaryOperatorRole(user.roles);
  const identity = createHash("sha256").update(user.id).digest("hex").slice(0, 16);
  const initialProgress = await safeInitialProgress(user.id, user.roles, role);
  return <PipelineOperatorAcademy assignedRoles={user.roles} progressStorageKey={`pipeline-operator-training:${identity}`} initialProgress={initialProgress} />;
}

async function safeInitialProgress(principalId: string, roles: readonly string[], role: ReturnType<typeof primaryOperatorRole>): Promise<OperatorProgressRecord> {
  try {
    return await getOperatorProgressRecord(principalId, roles, role);
  } catch {
    return { revision: 0, progress: emptyOperatorProgress(role), updatedAt: null, persistence: "browser" };
  }
}

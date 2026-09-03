import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import PipelineDemoCenter from "@/components/pipeline/training/PipelineDemoCenter";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { getOperatorTrainingUser } from "@/lib/training/operator-training-access";

export const metadata: Metadata = {
  title: "Demo Center | AHS - Pipeline",
  description: "Isolated synthetic rehearsal environment for the Pipeline admissions workflow.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PipelineDemoPage() {
  const [user, environment] = await Promise.all([
    getOperatorTrainingUser(new Headers(await headers())),
    Promise.resolve(getPipelineDemoEnvironment()),
  ]);
  if (!user || !environment.enabled) notFound();

  return (
    <PipelineDemoCenter
      actor={{ id: user.id, name: user.name, email: user.email, roles: user.roles }}
      environment={environment}
    />
  );
}

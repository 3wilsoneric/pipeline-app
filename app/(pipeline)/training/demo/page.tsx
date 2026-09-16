import type { Metadata } from "next";
import { notFound } from "next/navigation";

import PipelineDemoCenter, { PipelineWorkshopPresentation } from "@/components/pipeline/training/PipelineDemoCenter";
import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { getOperatorTrainingUser } from "@/lib/training/operator-training-access";

export const metadata: Metadata = {
  title: "Assessor's Workshop | AHS - Pipeline",
  description: "Assessor orientation followed by a live referral walkthrough on your Pipeline account.",
  robots: { index: false, follow: false, nocache: true },
};

export default async function PipelineDemoPage({
  searchParams,
}: {
  searchParams: Promise<{ slide?: string | string[]; view?: string | string[]; journey?: string | string[] }>;
}) {
  const requestedParams = await searchParams;
  const requestedSlide = requestedParams.slide;
  const requestHeaders = await getServerComponentRequestHeaders();
  const user = await getOperatorTrainingUser(requestHeaders);
  if (!user) notFound();

  // The existing admin utility is separate from the presentation-only workshop.
  if (requestedParams.view === "tester") {
    const environment = getPipelineDemoEnvironment();
    if (!user.roles.includes("admin") || !environment.enabled) notFound();
    return <PipelineDemoCenter actor={{ id: user.id, name: user.name, email: user.email, roles: user.roles }} environment={environment} initialView="tester" />;
  }

  return (
    <PipelineWorkshopPresentation
      initialPresentationSlide={typeof requestedSlide === "string" ? requestedSlide : undefined}
    />
  );
}

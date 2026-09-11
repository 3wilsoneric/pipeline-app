import type { Metadata } from "next";
import { notFound } from "next/navigation";

import FocusedAssessmentDemo from "@/components/pipeline/training/FocusedAssessmentDemo";
import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { getOperatorTrainingUser } from "@/lib/training/operator-training-access";

export const metadata: Metadata = {
  title: "Assessment Preview | AHS - Pipeline",
  robots: { index: false, follow: false, nocache: true },
};

export default async function FocusedAssessmentPreviewPage() {
  const requestHeaders = await getServerComponentRequestHeaders();
  const [user, environment] = await Promise.all([
    getOperatorTrainingUser(requestHeaders),
    Promise.resolve(getPipelineDemoEnvironment()),
  ]);
  if (!user || !environment.enabled) notFound();

  return <FocusedAssessmentDemo />;
}

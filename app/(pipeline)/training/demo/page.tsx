import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";

import PipelineDemoCenter from "@/components/pipeline/training/PipelineDemoCenter";
import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";
import { getPipelineDemoEnvironment } from "@/lib/demo/demo-environment";
import { getOperatorTrainingUser } from "@/lib/training/operator-training-access";

export const metadata: Metadata = {
  title: "Assessor's Workshop | AHS - Pipeline",
  description: "Presentation and isolated synthetic referral practice.",
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
  const [user, environment] = await Promise.all([
    getOperatorTrainingUser(requestHeaders),
    Promise.resolve(getPipelineDemoEnvironment()),
  ]);
  if (!user) notFound();
  redirectToExternalWorkshop(environment.entryUrl, requestHeaders.get("host"));
  if (!environment.enabled) notFound();
  const demoPersona = "demoPersona" in user ? user.demoPersona : undefined;

  return (
    <PipelineDemoCenter
      actor={{ id: user.id, name: user.name, email: user.email, roles: user.roles, demoPersona }}
      environment={environment}
      initialPresentationSlide={typeof requestedSlide === "string" ? requestedSlide : undefined}
      initialView={requestedParams.view === "tester" && user.roles.includes("admin") ? "tester" : undefined}
      journey={requestedParams.journey === "1" && Boolean(demoPersona) && environment.writable}
    />
  );
}

function redirectToExternalWorkshop(entryUrl: string | null, requestHost: string | null) {
  if (!entryUrl?.startsWith("https://")) return;
  if (new URL(entryUrl).host === requestHost) return;
  redirect(entryUrl);
}

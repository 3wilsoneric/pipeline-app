import { notFound } from "next/navigation";
import TutorialReferralPractice from "@/components/pipeline/training/TutorialReferralPractice";
import { getServerComponentRequestHeaders } from "@/lib/auth/server-component-request";
import { getOperatorTrainingUser } from "@/lib/training/operator-training-access";
import { tutorialReferralEntry } from "@/lib/training/tutorial-referral";

export const metadata = { title: "Referral tutorial | Pipeline", robots: { index: false, follow: false } };

export default async function ReferralTutorialPage({ searchParams }: { searchParams: Promise<{ task?: string; returnTo?: string }> }) {
  const user = await getOperatorTrainingUser(await getServerComponentRequestHeaders());
  if (!user) notFound();
  const params = await searchParams;
  return <TutorialReferralPractice initialStep={tutorialReferralEntry(params.task ?? "assessor-shift") ?? 0} returnTo={params.returnTo} />;
}

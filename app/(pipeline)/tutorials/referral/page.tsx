import { redirect } from "next/navigation";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export const metadata = { title: "Referral tutorial | Pipeline", robots: { index: false, follow: false } };

export default function ReferralTutorialPage() {
  redirect(toPipelinePath("/"));
}

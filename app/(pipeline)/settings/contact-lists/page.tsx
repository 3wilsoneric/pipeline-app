import type { Metadata } from "next";
import { notFound } from "next/navigation";
import CommunityContactLists from "@/components/pipeline/CommunityContactLists";
import { recipientListsAvailable } from "@/lib/pipeline/community-recipient-list-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Contact lists | AHS - Pipeline", robots: { index: false, follow: false, nocache: true } };

export default function ContactListsPage() {
  if (!recipientListsAvailable()) notFound();
  return <CommunityContactLists />;
}

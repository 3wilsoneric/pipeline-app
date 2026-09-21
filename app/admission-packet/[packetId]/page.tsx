import type { Metadata } from "next";
import { notFound } from "next/navigation";
import AdmissionPacketRecipient from "@/components/pipeline/AdmissionPacketRecipient";
import { validPacketId } from "@/lib/notifications/admission-packet-store";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admission packet · Pipeline", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function AdmissionPacketPage({ params, searchParams }: { params: Promise<{ packetId: string }>; searchParams: Promise<{ download?: string }> }) {
  const { packetId } = await params;
  if (!validPacketId(packetId)) notFound();
  return <AdmissionPacketRecipient packetId={packetId} downloadError={(await searchParams).download === "retry"} />;
}

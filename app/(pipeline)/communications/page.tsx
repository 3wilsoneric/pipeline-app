import type { Metadata } from "next";
import CommunicationHistory from "@/components/pipeline/CommunicationHistory";

export const metadata: Metadata = { title: "Communications | AHS - Pipeline", robots: { index: false, follow: false, nocache: true } };
export default function CommunicationsPage() { return <CommunicationHistory />; }

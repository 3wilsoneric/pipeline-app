import type { Metadata } from "next";

import StaffProfileSettings from "@/components/pipeline/StaffProfileSettings";

export const metadata: Metadata = {
  title: "Staff profile | AHS - Pipeline",
  description: "View account identity and edit staff profile preferences.",
  robots: { index: false, follow: false, nocache: true },
};

export default function SettingsPage() {
  return <StaffProfileSettings />;
}

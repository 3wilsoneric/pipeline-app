import type { Metadata } from "next";

import StaffProfileSettings from "@/components/pipeline/StaffProfileSettings";

export const metadata: Metadata = {
  title: "Settings | AHS - Pipeline",
  description: "Manage contacts, your profile, and your workspace.",
  robots: { index: false, follow: false, nocache: true },
};

export default function SettingsPage() {
  return <StaffProfileSettings />;
}

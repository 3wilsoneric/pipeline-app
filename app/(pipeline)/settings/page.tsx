import type { Metadata } from "next";

import StaffProfileSettings from "@/components/pipeline/StaffProfileSettings";

export const metadata: Metadata = {
  title: "Profile settings | AHS - Pipeline",
  description: "View account identity and edit Pipeline preferences.",
  robots: { index: false, follow: false, nocache: true },
};

export default function SettingsPage() {
  return <StaffProfileSettings />;
}

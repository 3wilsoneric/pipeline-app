import type { Metadata } from "next";
import PipelineAuthProvider from "@/components/auth/PipelineAuthProvider";
import DesktopRuntime from "@/components/desktop/DesktopRuntime";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import "./globals.css";

export const metadata: Metadata = {
  title: "Pipeline",
  description: "Pipeline referral and assessment management",
  applicationName: "Pipeline",
  manifest: isPipelineDesktopEnabled() ? toPipelinePath("/desktop-manifest.webmanifest") : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <PipelineAuthProvider>
          <DesktopRuntime />
          {children}
        </PipelineAuthProvider>
      </body>
    </html>
  );
}

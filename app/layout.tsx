import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import PipelineAuthProvider from "@/components/auth/PipelineAuthProvider";
import DesktopRuntime from "@/components/desktop/DesktopRuntime";
import PipelineMaintenanceCover from "@/components/pipeline/PipelineMaintenanceCover";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { getPipelineServerEntryUser } from "@/lib/auth/server-entry";
import "./globals.css";
import "./control-polish.css";

const pipelineSans = Inter({
  subsets: ["latin"],
  variable: "--font-pipeline-sans",
  display: "swap",
  preload: false,
  fallback: ["Helvetica Neue", "Helvetica", "Arial", "sans-serif"],
});

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export const metadata: Metadata = {
  title: "AHS - Pipeline",
  description: "Pipeline referral and assessment management",
  applicationName: "Pipeline",
  icons: {
    icon: [{
      url: toPipelinePath("/pwa/pipeline-favicon-32-v3.png"),
      type: "image/png",
      sizes: "32x32",
    }],
    shortcut: [{
      url: toPipelinePath("/pwa/pipeline-favicon-32-v3.png"),
      type: "image/png",
      sizes: "32x32",
    }],
  },
  manifest: isPipelineDesktopEnabled() ? toPipelinePath("/desktop-manifest.webmanifest") : undefined,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const initialUser = await getPipelineServerEntryUser();
  const temporarilyDisabled = process.env.PIPELINE_MAINTENANCE_MODE === "true";
  return (
    <html lang="en" data-design="v2" className={`${pipelineSans.variable} h-full antialiased`}>
      <body className="pipeline-interactions min-h-full">
        <PipelineAuthProvider initialUser={initialUser}>
          <DesktopRuntime />
          {temporarilyDisabled ? <div inert aria-hidden="true">{children}</div> : children}
          {temporarilyDisabled ? <PipelineMaintenanceCover /> : null}
        </PipelineAuthProvider>
      </body>
    </html>
  );
}

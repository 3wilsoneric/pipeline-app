import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Figtree } from "next/font/google";
import { DesignSwitchProvider } from "@/components/design/DesignSwitch";
import PipelineAuthProvider from "@/components/auth/PipelineAuthProvider";
import DesktopRuntime from "@/components/desktop/DesktopRuntime";
import PipelineMaintenanceCover from "@/components/pipeline/PipelineMaintenanceCover";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import { getPipelineServerEntryUser } from "@/lib/auth/server-entry";
import "./globals.css";
import "./control-polish.css";

const pipelineSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-pipeline-sans",
  display: "swap",
  fallback: ["Arial", "Helvetica", "sans-serif"],
  adjustFontFallback: "Arial",
  weight: "100 900",
});

// Redesign typeface; only downloaded by browsers when the design switch uses it.
const designV2Sans = Figtree({
  subsets: ["latin"],
  variable: "--font-design-v2-sans",
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
  // Off unless explicitly enabled; production stays on the current design (docs/design/DECISIONS.md).
  const designV2 = process.env.PIPELINE_DESIGN_V2 === "true";
  return (
    <html lang="en" data-design={designV2 ? "v2" : undefined} className={`${pipelineSans.variable} ${designV2Sans.variable} h-full antialiased`}>
      <body className="pipeline-interactions min-h-full">
        <DesignSwitchProvider v2={designV2}>
        <PipelineAuthProvider initialUser={initialUser}>
          <DesktopRuntime />
          {temporarilyDisabled ? <div inert aria-hidden="true">{children}</div> : children}
          {temporarilyDisabled ? <PipelineMaintenanceCover /> : null}
        </PipelineAuthProvider>
        </DesignSwitchProvider>
      </body>
    </html>
  );
}

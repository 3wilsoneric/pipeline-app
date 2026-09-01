import type { Metadata } from "next";
import localFont from "next/font/local";
import PipelineAuthProvider from "@/components/auth/PipelineAuthProvider";
import DesktopRuntime from "@/components/desktop/DesktopRuntime";
import { isPipelineDesktopEnabled } from "@/lib/desktop/desktop-config";
import { toPipelinePath } from "@/lib/pipeline/base-path";
import "./globals.css";

const pipelineSans = localFont({
  src: "./fonts/geist-latin.woff2",
  variable: "--font-pipeline-sans",
  display: "swap",
  fallback: ["Arial", "Helvetica", "sans-serif"],
  adjustFontFallback: "Arial",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "Pipeline",
  description: "Pipeline referral and assessment management",
  applicationName: "Pipeline",
  icons: {
    icon: [{ url: toPipelinePath("/brand/pipeline-mark.svg"), type: "image/svg+xml" }],
    shortcut: [{ url: toPipelinePath("/brand/pipeline-mark.svg"), type: "image/svg+xml" }],
  },
  manifest: isPipelineDesktopEnabled() ? toPipelinePath("/desktop-manifest.webmanifest") : undefined,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${pipelineSans.variable} h-full antialiased`}>
      <body className="min-h-full">
        <PipelineAuthProvider>
          <DesktopRuntime />
          {children}
        </PipelineAuthProvider>
      </body>
    </html>
  );
}

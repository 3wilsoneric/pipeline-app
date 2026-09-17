import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizePipelineBasePath } from "./shared/pipeline-base-path.mjs";
import { PIPELINE_PERMISSIONS_POLICY, pipelineContentSecurityPolicy } from "./shared/pipeline-security-headers.mjs";
import { assertPersonaDemoIsolation } from "./shared/persona-demo-config.mjs";

assertPersonaDemoIsolation();

const projectRoot = dirname(fileURLToPath(import.meta.url));
const basePath = normalizePipelineBasePath(process.env.NEXT_PUBLIC_PIPELINE_BASE_PATH);
const isDevelopment = process.env.NODE_ENV !== "production";
const contentSecurityPolicy = pipelineContentSecurityPolicy({ development: isDevelopment, storageAccount: process.env.AZURE_STORAGE_ACCOUNT });

const nextConfig: NextConfig = {
  basePath: basePath || undefined,
  output: "standalone",
  deploymentId: process.env.PIPELINE_DEPLOYMENT_ID?.trim() || undefined,
  devIndicators: false,
  poweredByHeader: false,
  distDir: process.env.PIPELINE_NEXT_DIST_DIR?.trim() || ".next",
  serverExternalPackages: [
    "@napi-rs/canvas",
    "@tesseract.js-data/eng",
    "pdfjs-dist",
    "tesseract.js",
  ],
  outputFileTracingIncludes: {
    "/*": [
      "node_modules/@napi-rs/canvas/**/*",
      "node_modules/@tesseract.js-data/eng/**/*",
      "node_modules/pdfjs-dist/**/*",
      "node_modules/tesseract.js/**/*",
      "node_modules/tesseract.js-core/**/*",
    ],
  },
  // Pipeline emits its own bounded, redacted request logs. Next's development
  // logger includes raw URLs, which can contain resident or referral keys.
  logging: false,
  // Next 16's stable compiler keeps large chart edits local. Browser journey
  // tests cover hydration, query-only navigation, drafts, and field input.
  reactCompiler: true,
  turbopack: {
    root: projectRoot,
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: basePath ? `${basePath}/` : "/" },
        ],
      },
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "Permissions-Policy", value: PIPELINE_PERMISSIONS_POLICY },
        ],
      },
      {
        // API document/evidence routes supply their own restrictive policies.
        source: "/((?!api(?:/|$)).*)",
        headers: [{ key: "Content-Security-Policy", value: contentSecurityPolicy }],
      },
      {
        source: "/api/referrals/:referralId/packet",
        headers: [
          { key: "Content-Security-Policy", value: "default-src 'none'; frame-ancestors 'self';" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};

export default nextConfig;

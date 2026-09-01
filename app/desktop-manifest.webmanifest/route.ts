import type { MetadataRoute } from "next";
import { toPipelinePath } from "@/lib/pipeline/base-path";

export const dynamic = "force-static";

const pipelineRoot = toPipelinePath("/");
const pipelineScope = pipelineRoot === "/" ? "/" : `${pipelineRoot}/`;

const manifest: MetadataRoute.Manifest = {
  id: pipelineScope,
  name: "Pipeline",
  short_name: "Pipeline",
  description: "Pipeline referral packets, assessments, and client records.",
  start_url: pipelineScope,
  scope: pipelineScope,
  display: "standalone",
  background_color: "#ffffff",
  theme_color: "#118c78",
  orientation: "any",
  categories: ["business", "medical", "productivity"],
  icons: [
    {
      src: toPipelinePath("/pwa/pipeline-icon-192-v2.png"),
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: toPipelinePath("/pwa/pipeline-icon-512-v2.png"),
      sizes: "512x512",
      type: "image/png",
    },
    {
      src: toPipelinePath("/pwa/pipeline-icon-maskable-512-v2.png"),
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

export function GET() {
  return Response.json(manifest, {
    headers: {
      "Cache-Control": "public, max-age=0, must-revalidate",
      "Content-Type": "application/manifest+json",
    },
  });
}

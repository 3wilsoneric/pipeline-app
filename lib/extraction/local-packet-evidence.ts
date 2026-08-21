import "server-only";

import path from "node:path";

import { createCanvas, loadImage } from "@napi-rs/canvas";

import { readLocalReferralPacket } from "@/lib/pipeline/local-document-store";

const maxRenderedPixels = 20_000_000;

export async function renderLocalPacketEvidence(input: {
  documentHash: string;
  pageNumber: number;
}) {
  const packet = await readLocalReferralPacket(input.documentHash);
  if (!packet || !Number.isInteger(input.pageNumber) || input.pageNumber < 1) return null;

  if (packet.contentType === "application/pdf") {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const loadingTask = getDocument({
      data: Uint8Array.from(packet.bytes),
      wasmUrl: `${path.join(process.cwd(), "node_modules", "pdfjs-dist", "wasm")}${path.sep}`,
    });
    const document = await loadingTask.promise;
    try {
      if (input.pageNumber > document.numPages) return null;
      const page = await document.getPage(input.pageNumber);
      try {
        const natural = page.getViewport({ scale: 1 });
        const scale = Math.min(2, 1600 / Math.max(1, natural.width));
        const viewport = page.getViewport({ scale });
        if (viewport.width * viewport.height > maxRenderedPixels) return null;
        const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
        await page.render({
          canvas: canvas as never,
          canvasContext: canvas.getContext("2d") as never,
          viewport,
        }).promise;
        return canvas.toBuffer("image/png");
      } finally {
        page.cleanup();
      }
    } finally {
      await loadingTask.destroy();
    }
  }

  if (!packet.contentType.startsWith("image/") || input.pageNumber !== 1) return null;
  const image = await loadImage(packet.bytes);
  if (image.width <= 0 || image.height <= 0 || image.width * image.height > maxRenderedPixels) return null;
  const canvas = createCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, image.width, image.height);
  context.drawImage(image, 0, 0);
  return canvas.toBuffer("image/png");
}

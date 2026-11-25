import "server-only";
import { createHash } from "node:crypto";
import { getDocumentOriginalAsset, getDocumentPreviewAsset, getDocumentReferralId, proxyDocumentAsset } from "./document-assets";
import { DocumentProcessingError } from "./document-processing";
import { readDocumentPageText } from "./local-packet-ingestion";
import { getLocalUploadedDocument, getReferral, getReferralStoreReadiness } from "@/lib/pipeline/referral-store";
import { readLocalReferralPacket } from "@/lib/pipeline/local-document-store";

// Source-owned file binding and malware gates run on every read. A hash binds
// page continuations to the actual bytes, including safe converted previews.
export async function readReferralDocumentPage(referralId: number, documentId: string, pageNumber: number, expectedHash?: string) {
  let bytes: Uint8Array, contentType: string, source = "original";
  if (getReferralStoreReadiness().mode === "local_file") {
    const document = await getLocalUploadedDocument(documentId);
    const referral = await getReferral(referralId);
    const hash = document && !document.deletedAt && document.file.referralId === referralId ? document.hash
      : documentId === `referral-${referralId}-packet` ? referral?.documentHash : null;
    const packet = hash ? await readLocalReferralPacket(hash) : null;
    if (!packet) throw new DocumentProcessingError("file_not_found", 404, "File not found in this workspace.");
    bytes = packet.bytes; contentType = packet.contentType;
  } else {
    if (await getDocumentReferralId(documentId) !== referralId) throw new DocumentProcessingError("file_not_found", 404, "File not found in this workspace.");
    let asset = await getDocumentOriginalAsset(documentId);
    if (!asset) throw new DocumentProcessingError("file_not_found", 404, "File not found.");
    if (!["application/pdf", "image/png", "image/jpeg"].includes(asset.contentType)) {
      asset = await getDocumentPreviewAsset(documentId);
      source = "converted-preview";
    }
    if (!asset) throw new DocumentProcessingError("text_unavailable", 409, "A safe document preview is not available.");
    const response = await proxyDocumentAsset(new Request("https://pipeline.invalid/internal-document-read"), asset);
    if (!response.ok) throw new DocumentProcessingError("document_unavailable", response.status === 413 ? 413 : 502, "The document could not be read.");
    bytes = new Uint8Array(await response.arrayBuffer()); contentType = asset.contentType;
  }
  const documentHash = createHash("sha256").update(bytes).digest("hex");
  if (expectedHash && expectedHash !== documentHash) throw new DocumentProcessingError("document_changed", 409, "The document changed. Restart its page reads.");
  const page = await readDocumentPageText(bytes, contentType, pageNumber);
  return { documentId, documentHash, source, ...page, nextPage: pageNumber < page.pageCount ? pageNumber + 1 : null,
    coverage: "one-page", interpretation: page.method === "ocr" ? "OCR may contain recognition errors; retain page citation." : "Embedded PDF text; visual content may not be represented." };
}

// Approved-user uploads do not require malware scanning. Preserve authentic
// historical verdicts and never represent an unscanned document as clean.
export function isDocumentContentAvailable(scanStatus: string | undefined): boolean {
  return scanStatus === "clean" || scanStatus === "not_scanned";
}

export function isBrowserPreviewable(contentType: string | undefined): boolean {
  return ["application/pdf", "image/jpeg", "image/png", "image/gif", "image/webp", "image/bmp", "text/plain"].includes(contentType ?? "");
}

export function originalDocumentDisposition(contentType: string | undefined): "inline" | "attachment" {
  return isBrowserPreviewable(contentType) ? "inline" : "attachment";
}

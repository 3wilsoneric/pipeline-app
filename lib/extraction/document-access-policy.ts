// Approved-user uploads do not require malware scanning. Preserve authentic
// historical verdicts and never represent an unscanned document as clean.
export function isDocumentContentAvailable(scanStatus: string | undefined): boolean {
  return scanStatus === "clean" || scanStatus === "not_scanned";
}

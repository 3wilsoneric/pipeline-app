export function buildOriginalBlobPath(packetId: string, fileId: string, filename: string): string {
  if (!isUuid(packetId)) throw new Error("A durable packet id is required before signing uploads.");
  return `${packetId}/original/${opaqueFileName(fileId, filename)}`;
}

function opaqueFileName(fileId: string, filename: string) {
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  if (!safeId) throw new Error("The upload file id is invalid.");
  const extension = filename.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? "bin";
  return `${safeId}.${extension}`;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

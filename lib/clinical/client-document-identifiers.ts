export type ClinicalClientDocumentRouteContext = {
  params: Promise<{ residentKey: string; documentId: string }>;
};

export async function parseClinicalClientDocumentIdentifiers(
  context: ClinicalClientDocumentRouteContext,
) {
  const { residentKey, documentId } = await context.params;
  try {
    const canonicalClientId = decodeURIComponent(residentKey).trim();
    const normalizedDocumentId = decodeURIComponent(documentId).trim();
    if (
      !canonicalClientId ||
      canonicalClientId.length > 256 ||
      !normalizedDocumentId ||
      normalizedDocumentId.length > 256
    ) {
      return null;
    }
    return { canonicalClientId, documentId: normalizedDocumentId };
  } catch {
    return null;
  }
}

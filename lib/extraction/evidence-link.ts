/** Keep source links navigable without allowing document data to supply executable URLs. */
export function evidenceLink(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value, "https://pipeline.invalid");
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    return url.origin === "https://pipeline.invalid"
      ? `${url.pathname}${url.search}${url.hash}`
      : url.href;
  } catch {
    return null;
  }
}

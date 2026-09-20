import { toPipelinePath } from "@/lib/pipeline/base-path";

/** Evidence always opens through the packet's authenticated asset route. */
export function evidenceLink(packetId: string | undefined, fieldKey: string): string | null {
  if (!packetId || !fieldKey) return null;
  if (/^\.\.?$/.test(packetId) || /^\.\.?$/.test(fieldKey)) return null;
  try {
    return toPipelinePath(`/api/packets/${encodeURIComponent(packetId)}/evidence/${encodeURIComponent(fieldKey)}`);
  } catch {
    return null;
  }
}

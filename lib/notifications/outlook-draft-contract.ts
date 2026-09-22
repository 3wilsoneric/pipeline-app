export type OutlookDraftState = "preparing" | "draft" | "unconfirmed" | "sent" | "needs_review" | "discarded";
export type OutlookDraftView = {
  packet_id: string;
  status: OutlookDraftState;
  mailbox: string;
  web_link?: string;
  prepared_at: string;
  assessment_version: number;
  file_count: number;
  message?: string;
  to_recipients?: string[];
  cc_recipients?: string[];
};

export function safeOutlookWebLink(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    if (!["outlook.office.com", "outlook.office365.com", "outlook.live.com"].includes(url.hostname)) return undefined;
    return url.toString();
  } catch { return undefined; }
}

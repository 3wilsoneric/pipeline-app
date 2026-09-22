import "server-only";
import type { PipelineUser } from "@/lib/auth/pipeline-auth";
import { PacketAccessError } from "./admission-packet-store";
import { isMeetClientLive } from "./microsoft-graph-mail";
import { safeOutlookWebLink } from "./outlook-draft-contract";

const graph = "https://graph.microsoft.com/v1.0";
const correlationProperty = "String {5e5d98a0-3b65-4e6c-a931-0c6213da276e} Name PipelineDeliveryId";
const messageFields = "id,isDraft,webLink,sentDateTime,subject,body,toRecipients,ccRecipients,bccRecipients";
type Address = { emailAddress?: { address?: string } };
export type OutlookMailbox = { token: string; id: string; email: string; graphId?: string };
export function getOutlookClientId() {
  const id = process.env.PIPELINE_OUTLOOK_CLIENT_ID?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ? id : "";
}
export type OutlookMessage = {
  id: string; isDraft: boolean; webLink?: string; sentDateTime?: string; subject?: string;
  body?: { content?: string }; toRecipients?: Address[]; ccRecipients?: Address[]; bccRecipients?: Address[];
};
export class OutlookMailError extends Error {
  constructor(public status: number, public definitive = false) {
    super(status === 401 ? "Reconnect your Outlook account and try again."
      : status === 403 ? "Outlook draft access has not been approved for your organization. See the Outlook setup steps."
      : status === 429 ? "Outlook is busy. Wait a minute, then check the draft again."
      : "Outlook could not confirm the request. Check the existing draft before trying again.");
  }
}
export async function connectedOutlookMailbox(request: Request, user: PipelineUser) {
  if (user.delegation) throw new PacketAccessError("Leave the assessor session and connect Outlook as yourself.", 403);
  const token = request.headers.get("x-pipeline-outlook-token") ?? "";
  if (!token || token.length > 16384 || /[\r\n]/.test(token)) throw new PacketAccessError("Connect your Outlook account first.", 428);
  const profile = await outlookRequest<{ id?: string; mail?: string; userPrincipalName?: string }>(token, "/me?$select=id,mail,userPrincipalName");
  const email = (profile.mail || profile.userPrincipalName || "").trim().toLowerCase();
  if (!profile.id || email.includes("#ext#") || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new PacketAccessError("This Microsoft account does not have an Outlook mailbox address.", 403);
  const accountEmail = user.email?.trim().toLowerCase();
  // Guest identities have a different object ID in Pipeline's tenant than in
  // their home mailbox. Use the authenticated identity's email, never a profile
  // field or caller-supplied address; pin the home mailbox ID on each packet.
  if (profile.id.toLowerCase() !== user.id.toLowerCase() && (!accountEmail || email !== accountEmail)) {
    throw new PacketAccessError("Choose the Outlook mailbox matching your Pipeline email address.", 403);
  }
  return { token, id: user.id, graphId: profile.id, email };
}
export async function createOutlookMessage(token: string, input: { deliveryId: string; subject: string; html: string; recipients: string[]; ccRecipients: string[] }) {
  if (!isMeetClientLive()) throw new PacketAccessError("Not production yet — no Outlook draft will be created.", 403);
  return outlookRequest<OutlookMessage>(token, "/me/messages", { method: "POST", body: JSON.stringify({
    subject: input.subject, body: { contentType: "HTML", content: input.html },
    toRecipients: input.recipients.map(address), ccRecipients: input.ccRecipients.map(address),
    singleValueExtendedProperties: [{ id: correlationProperty, value: input.deliveryId }],
    internetMessageHeaders: [{ name: "x-pipeline-delivery-id", value: input.deliveryId }],
  }) });
}
export async function findOutlookMessage(token: string, packetId: string, messageId?: string): Promise<OutlookMessage | null> {
  if (messageId) {
    try { return await outlookRequest<OutlookMessage>(token, `/me/messages/${encodeURIComponent(messageId)}?$select=${messageFields}`); }
    catch (error) { if (!(error instanceof OutlookMailError) || error.status !== 404) throw error; }
  }
  const filter = `singleValueExtendedProperties/Any(ep: ep/id eq '${correlationProperty}' and ep/value eq '${packetId}')`;
  const query = new URLSearchParams({ "$filter": filter, "$select": messageFields, "$top": "2" });
  const result = await outlookRequest<{ value: OutlookMessage[] }>(token, `/me/messages?${query}`);
  if (!Array.isArray(result.value) || result.value.length > 1) throw new PacketAccessError("More than one Outlook message matches this packet. Review the mailbox before continuing.", 409);
  return result.value[0] ?? null;
}
export async function deleteOutlookDraft(token: string, messageId: string) {
  await outlookRequest(token, `/me/messages/${encodeURIComponent(messageId)}`, { method: "DELETE" });
}
export function outlookAudience(message: OutlookMessage) {
  return [...new Set([...(message.toRecipients ?? []), ...(message.ccRecipients ?? []), ...(message.bccRecipients ?? [])]
    .map((value) => value.emailAddress?.address?.trim().toLowerCase() ?? ""))].sort();
}
export function outlookMessageLink(message: OutlookMessage) { return safeOutlookWebLink(message.webLink); }
const address = (value: string) => ({ emailAddress: { address: value } });

async function outlookRequest<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${graph}${path}`, { ...init, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(30_000),
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId", outlook.body-content-type="text"' } });
  } catch { throw new OutlookMailError(503); }
  if (!response.ok) throw new OutlookMailError(response.status, [400, 401, 403, 404, 405, 413, 415, 422, 429].includes(response.status));
  if (response.status === 204) return undefined as T;
  // Never log Graph payloads: messages and addresses contain private client data.
  const reader = response.body?.getReader();
  if (!reader) throw new OutlookMailError(502);
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 512_000) { await reader.cancel(); throw new OutlookMailError(502); }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
  } catch { throw new OutlookMailError(502); }
  finally { reader.releaseLock(); }
}

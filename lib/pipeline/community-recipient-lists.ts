import { pipelineCommunities, type PipelineCommunity } from "./community-config";

export type ListCommunity = Exclude<PipelineCommunity, "Unassigned">;
export type ListRecipient = { name: string; email: string };
export type RecipientFields = { to: ListRecipient[]; cc: ListRecipient[] };
export type CommunityRecipientList = RecipientFields & {
  community: ListCommunity;
  version: number;
  sourceDates: string[];
  updatedAt: string | null;
};
export const recipientListLimit = 100;

export function isListCommunity(value: unknown): value is ListCommunity {
  return value !== "Unassigned" && pipelineCommunities.some((community) => community === value);
}

export function parseListRecipient(value: unknown): ListRecipient | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { name, email } = value as Record<string, unknown>;
  if (typeof name !== "string" || name.length > 160 || /[\x00-\x1f\x7f<>]/u.test(name)) return null;
  if (typeof email !== "string" || email.length > 254 || !/^[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+$/iu.test(email.trim())) return null;
  return { name: name.trim(), email: email.trim().toLowerCase() };
}

export function parseRecipientFields(value: unknown): RecipientFields | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { to, cc } = value as Record<string, unknown>;
  if (!Array.isArray(to) || !Array.isArray(cc) || to.length + cc.length > recipientListLimit) return null;
  const parsedTo = to.map(parseListRecipient);
  const parsedCc = cc.map(parseListRecipient);
  const all = [...parsedTo, ...parsedCc];
  if (all.some((item) => !item) || new Set(all.map((item) => item!.email)).size !== all.length) return null;
  return { to: parsedTo as ListRecipient[], cc: parsedCc as ListRecipient[] };
}

export function parseRecipientListCommand(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const { community, version, mutationId } = value as Record<string, unknown>;
  if (!isListCommunity(community)) return null;
  if (!Number.isSafeInteger(version) || Number(version) < 1) return null;
  if (typeof mutationId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(mutationId)) return null;
  const recipients = parseRecipientFields(value);
  return recipients ? { community, version: Number(version), mutationId, recipients } : null;
}

export function parseRecipientText(text: string): { recipients: ListRecipient[]; error?: never } | { error: string; recipients?: never } {
  if (text.length > 32_000) return { error: "Paste up to 100 recipients at a time." };
  const tokens = splitRecipients(text);
  if (tokens.length > recipientListLimit) return { error: "A list can contain up to 100 recipients." };
  const recipients: ListRecipient[] = [];
  for (const token of tokens) {
    const named = /^(.*?)\s*<([^<>]+)>$/u.exec(token);
    const name = named ? named[1].replace(/^"(.*)"$/u, "$1").replace(/\\"/gu, '"') : "";
    const recipient = parseListRecipient({ name, email: named?.[2] ?? token });
    if (!recipient) return { error: "Use an email address or Name <email@example.com>. Separate contacts with a semicolon, comma, or new line." };
    if (!recipients.some((item) => item.email === recipient.email)) recipients.push(recipient);
  }
  return { recipients };
}

function splitRecipients(text: string) {
  const tokens: string[] = [];
  let token = "";
  let quoted = false;
  let angle = false;
  for (const char of text.trim()) {
    if (char === '"' && !token.endsWith("\\")) quoted = !quoted;
    if (!quoted && char === "<") angle = true;
    if (!quoted && char === ">") angle = false;
    if (isRecipientSeparator(char, quoted, angle)) {
      tokens.push(token);
      token = "";
    } else token += char;
  }
  tokens.push(token);
  return tokens.map((value) => value.trim()).filter(Boolean);
}

function isRecipientSeparator(char: string, quoted: boolean, angle: boolean) {
  return !quoted && !angle && /[;,\r\n]/u.test(char);
}

export function addListRecipients(fields: RecipientFields, lane: keyof RecipientFields, recipients: ListRecipient[]) {
  const existing = new Set([...fields.to, ...fields.cc].map((item) => item.email.toLowerCase()));
  const additions = recipients.filter((item) => {
    if (existing.has(item.email.toLowerCase())) return false;
    existing.add(item.email.toLowerCase());
    return true;
  });
  if (existing.size > recipientListLimit) throw new Error("A list can contain up to 100 recipients.");
  return { fields: { ...fields, [lane]: [...fields[lane], ...additions] }, added: additions.length };
}

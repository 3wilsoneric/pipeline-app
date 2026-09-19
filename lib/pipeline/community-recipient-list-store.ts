import "server-only";

import { open, readFile, rename, unlink, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { isPersonaDemo } from "@/lib/demo/persona-session";
import { isListCommunity, parseRecipientFields, type CommunityRecipientList, type ListCommunity, type RecipientFields } from "./community-recipient-lists";

type StoredList = CommunityRecipientList & { lastMutation?: { id: string; actorId: string } };
type ListFile = { schema: 1; lists: StoredList[] };

// Draft-only local editor. Shared/live lists need a database-backed owner and
// explicit audience approval before they can be connected to email delivery.
export function recipientListsAvailable() {
  return isPersonaDemo() && Boolean(process.env.PIPELINE_PERSONA_DEMO_ROOT);
}

function storePath() {
  if (!recipientListsAvailable()) throw new Error("Local contact lists are unavailable.");
  return resolve(process.env.PIPELINE_PERSONA_DEMO_ROOT!, "community-recipient-lists.json");
}

async function readStore(): Promise<ListFile> {
  const path = storePath();
  if ((await stat(path)).size > 2_000_000) throw new Error("Contact list file is too large.");
  const data = JSON.parse(await readFile(path, "utf8")) as ListFile;
  if (data.schema !== 1 || !Array.isArray(data.lists) || data.lists.length > 5) throw new Error("Invalid contact list file.");
  const communities = new Set<string>();
  for (const list of data.lists) {
    if (!isListCommunity(list.community) || communities.has(list.community) || !parseRecipientFields(list)
      || !Number.isSafeInteger(list.version) || list.version < 1 || !Array.isArray(list.sourceDates)
      || !list.sourceDates.every((date) => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/u.test(date))) throw new Error("Invalid contact list file.");
    communities.add(list.community);
  }
  return data;
}

export async function readCommunityRecipientLists() {
  return (await readStore()).lists.map(publicList);
}

export async function saveCommunityRecipientList(input: {
  community: ListCommunity; version: number; recipients: RecipientFields; mutationId: string; actorId: string;
}): Promise<{ ok: true; list: CommunityRecipientList } | { ok: false; status: number; error: string }> {
  const path = storePath();
  const lock = await open(`${path}.lock`, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") return null;
    throw error;
  });
  if (!lock) return { ok: false, status: 409, error: "Another save is in progress. Your edits are still here; try Save again." };
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    const store = await readStore();
    const current = store.lists.find((list) => list.community === input.community);
    if (!current) return { ok: false, status: 404, error: "This community list was not found." };
    const sameRecipients = JSON.stringify(parseRecipientFields(current)) === JSON.stringify(input.recipients);
    if (current.lastMutation?.id === input.mutationId && current.lastMutation.actorId === input.actorId && sameRecipients) return { ok: true, list: publicList(current) };
    if (current.version !== input.version || current.lastMutation?.id === input.mutationId) {
      return { ok: false, status: 409, error: "This list changed in another tab. Your edits are still here. Reload the saved list before making further changes." };
    }
    const next: StoredList = { ...current, ...input.recipients, version: current.version + 1, updatedAt: new Date().toISOString(), lastMutation: { id: input.mutationId, actorId: input.actorId } };
    store.lists = store.lists.map((list) => list.community === next.community ? next : list);
    const file = await open(temporary, "wx", 0o600);
    try { await file.writeFile(JSON.stringify(store, null, 2)); await file.sync(); } finally { await file.close(); }
    await rename(temporary, path);
    return { ok: true, list: publicList(next) };
  } finally {
    await unlink(temporary).catch((error: NodeJS.ErrnoException) => { if (error.code !== "ENOENT") throw error; });
    await lock.close();
    await unlink(`${path}.lock`);
  }
}

function publicList(list: StoredList): CommunityRecipientList {
  return { community: list.community, version: list.version, to: list.to, cc: list.cc, sourceDates: list.sourceDates, updatedAt: list.updatedAt };
}

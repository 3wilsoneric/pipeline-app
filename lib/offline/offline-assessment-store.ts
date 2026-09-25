"use client";

import {
  assessmentInterviewFieldLabel,
  assessmentInterviewQuestions,
  assessmentInterviewSections,
  type AssessmentInterviewQuestion,
} from "@/lib/assessment/assessment-interview-schema";
import {
  assessmentToolFieldDefinitions,
  type AssessmentToolSection,
} from "@/lib/assessment/assessment-tool-schema";
import type { PipelineAssessmentDraft } from "@/lib/pipeline/user-workspace-state-types";

const databaseName = "pipeline-offline-v1";
const databaseVersion = 2;
const keysStore = "keys";
const recordsStore = "records";
const mutationsStore = "mutations";
const activeStore = "active";
const activeAssessmentKey = "current-assessment";
const expiryMs = 7 * 24 * 60 * 60 * 1_000;
// A Web Lock distinguishes a reload from a duplicated tab (which may inherit
// sessionStorage). Without locks, use a new slot rather than risk deleting an
// unsynced copy held by another tab; old slots expire with the store.
const recoverySessionStorageKey = "pipeline-recovery-session-v1";
let recoverySessionPromise: Promise<string> | undefined;
export function currentOfflineRecoverySessionId() {
  return recoverySessionPromise ??= acquireRecoverySession();
}

async function acquireRecoverySession() {
  let previous = "";
  try { previous = window.sessionStorage.getItem(recoverySessionStorageKey) ?? ""; } catch { /* Storage may be disabled. */ }
  const candidate = /^[0-9a-f-]{36}$/i.test(previous) ? previous : window.crypto.randomUUID();
  const sessionId = await claimRecoverySession(candidate) ? candidate : window.crypto.randomUUID();
  if (sessionId !== candidate) await claimRecoverySession(sessionId);
  try { window.sessionStorage.setItem(recoverySessionStorageKey, sessionId); } catch { /* The tab still has a unique in-memory slot. */ }
  return sessionId;
}

async function claimRecoverySession(id: string) {
  if (!window.navigator.locks?.request) return false;
  return new Promise<boolean>((resolve) => {
    void window.navigator.locks.request(`pipeline-recovery:${id}`, { ifAvailable: true }, async (lock) => {
      resolve(Boolean(lock));
      if (lock) await new Promise<void>(() => undefined); // Held for this document's lifetime.
    }).catch(() => resolve(false));
  });
}

type EncryptedPayload = {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

type StoredKey = { id: string; key: CryptoKey; createdAt: number };
type StoredRecord = EncryptedPayload & {
  id: string;
  principal: string;
  kind: "assessment-draft" | "assessment-working-set" | "referral-draft";
  sessionId?: string;
  updatedAt: number;
  expiresAt: number;
};

type StoredActiveAssessment = {
  id: typeof activeAssessmentKey;
  principal: string;
  recordId: string;
  updatedAt: number;
  expiresAt: number;
};

export type OfflineAssessmentQuestion = Pick<
  AssessmentInterviewQuestion,
  "field" | "group" | "control" | "options" | "showWhen" | "requiredWhen" | "help" | "placeholder" | "span" | "min" | "max"
> & {
  label: string;
  section: AssessmentToolSection;
  required: boolean;
};

export type OfflineAssessmentWorkingSet = {
  schema: 1;
  savedAt: string;
  returnPath: string;
  editable: boolean;
  draft: PipelineAssessmentDraft;
  sections: Array<{
    key: AssessmentToolSection;
    label: string;
    description: string;
  }>;
  questions: OfflineAssessmentQuestion[];
};

export type OfflineAssessmentMutation = {
  dedupeKey: string;
  url: string;
  method: "PATCH" | "POST";
  body: string;
  createdAt: string;
};

type StoredMutation = EncryptedPayload & {
  id: string;
  principal: string;
  updatedAt: number;
  expiresAt: number;
};

export type OfflineSyncResult = {
  completed: number;
  conflicts: number;
  remaining: number;
};

export async function initializeOfflineAssessmentStore(principalId: string) {
  const principal = await hashValue(principalId);
  const database = await openDatabase();
  await enforceActivePrincipal(database, principal);
  await getOrCreateKey(database, principal);
  await removeExpired(database, principal);
  database.close();
  return principal;
}

export async function saveOfflineAssessmentDraft(
  principalId: string,
  assessmentId: string,
  draft: PipelineAssessmentDraft,
) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const key = await getOrCreateKey(database, principal);
  const sessionId = await currentOfflineRecoverySessionId();
  const id = await recordId(principal, "assessment-draft", `${assessmentId}:${sessionId}`);
  const encrypted = await encryptPayload(key, principal, id, draft);
  const now = Date.now();
  const transaction = database.transaction(recordsStore, "readwrite");
  transaction.objectStore(recordsStore).put({
    id,
    principal,
    kind: "assessment-draft",
    sessionId,
    updatedAt: now,
    expiresAt: now + expiryMs,
    ...encrypted,
  } satisfies StoredRecord);
  await transactionDone(transaction);
  database.close();
}

export async function loadOfflineAssessmentDraft(principalId: string, assessmentId: string) {
  const database = await openDatabase();
  try {
    const principal = await hashValue(principalId);
    const sessionId = await currentOfflineRecoverySessionId();
    const records = (await recordsForPrincipal<StoredRecord>(database, recordsStore, principal))
      .filter((record) => record.kind === "assessment-draft" && record.expiresAt > Date.now())
      .sort((left, right) => Number(right.sessionId === sessionId) - Number(left.sessionId === sessionId) || right.updatedAt - left.updatedAt);
    if (!records.length) return null;
    const key = await getOrCreateKey(database, principal);
    let otherPending: PipelineAssessmentDraft | null = null;
    let clean: PipelineAssessmentDraft | null = null;
    let unreadable: unknown;
    for (const record of records) {
      let draft: PipelineAssessmentDraft;
      try {
        draft = await decryptPayload<PipelineAssessmentDraft>(key, principal, record.id, record);
      } catch (error) {
        unreadable ??= error;
        continue;
      }
      if (draft.assessmentId !== assessmentId) continue;
      if (draft.dirtySections.length > 0 || draft.scheduleDraft) {
        if (record.sessionId === sessionId) return draft;
        otherPending ??= draft;
      } else {
        clean ??= draft;
      }
    }
    if (!otherPending && !clean && unreadable) throw unreadable;
    return otherPending ?? clean;
  } finally {
    database.close();
  }
}

export async function removeOfflineAssessmentDraft(principalId: string, assessmentId: string) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const id = await recordId(principal, "assessment-draft", `${assessmentId}:${await currentOfflineRecoverySessionId()}`);
  await request(database.transaction(recordsStore, "readwrite").objectStore(recordsStore).delete(id));
  database.close();
}

export async function saveOfflineAssessmentWorkingSet(
  principalId: string,
  draft: PipelineAssessmentDraft,
  returnPath: string,
  options: { editable: boolean; activate?: boolean },
) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  if (options.activate !== false) await enforceActivePrincipal(database, principal);
  const key = await getOrCreateKey(database, principal);
  const id = await recordId(principal, "assessment-working-set", draft.assessmentId);
  const workingSet = createWorkingSet(draft, returnPath, options.editable);
  const encrypted = await encryptPayload(key, principal, id, workingSet);
  const now = Date.now();
  const transaction = database.transaction([recordsStore, activeStore], "readwrite");
  const activeRequest = transaction.objectStore(activeStore).get(activeAssessmentKey);
  activeRequest.onsuccess = () => {
    const previousActive = activeRequest.result as StoredActiveAssessment | undefined;
    // A late save acknowledgment can refresh the active offline copy, but must
    // never reactivate an old assessment or remove the one now being worked on.
    if (options.activate === false && previousActive?.recordId !== id) return;
    if (previousActive?.recordId && previousActive.recordId !== id) {
      transaction.objectStore(recordsStore).delete(previousActive.recordId);
    }
    transaction.objectStore(recordsStore).put({
      id,
      principal,
      kind: "assessment-working-set",
      updatedAt: now,
      expiresAt: now + expiryMs,
      ...encrypted,
    } satisfies StoredRecord);
    transaction.objectStore(activeStore).put({
      id: activeAssessmentKey,
      principal,
      recordId: id,
      updatedAt: now,
      expiresAt: now + expiryMs,
    } satisfies StoredActiveAssessment);
  };
  await transactionDone(transaction);
  database.close();
}

export async function loadOfflineAssessmentWorkingSet(principalId: string, assessmentId: string) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const id = await recordId(principal, "assessment-working-set", assessmentId);
  const stored = await request<StoredRecord | undefined>(database.transaction(recordsStore).objectStore(recordsStore).get(id));
  if (!stored || stored.expiresAt <= Date.now()) {
    if (stored) await deleteWorkingSet(database, id);
    database.close();
    return null;
  }
  const key = await getOrCreateKey(database, principal);
  const value = await decryptPayload<OfflineAssessmentWorkingSet>(key, principal, id, stored);
  database.close();
  return value;
}

export async function removeOfflineAssessmentWorkingSet(principalId: string, assessmentId: string) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const id = await recordId(principal, "assessment-working-set", assessmentId);
  await deleteWorkingSet(database, id);
  database.close();
}

export async function queueOfflineAssessmentMutation(principalId: string, mutation: OfflineAssessmentMutation) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const key = await getOrCreateKey(database, principal);
  const id = await recordId(principal, "assessment-mutation", mutation.dedupeKey);
  const encrypted = await encryptPayload(key, principal, id, mutation);
  const now = Date.now();
  const transaction = database.transaction(mutationsStore, "readwrite");
  transaction.objectStore(mutationsStore).put({
    id,
    principal,
    updatedAt: now,
    expiresAt: now + expiryMs,
    ...encrypted,
  } satisfies StoredMutation);
  await transactionDone(transaction);
  database.close();
  notifyOfflineStateChanged();
}

export async function pendingOfflineAssessmentMutations(principalId: string) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const records = await recordsForPrincipal<StoredMutation>(database, mutationsStore, principal);
  database.close();
  return records.filter((item) => item.expiresAt > Date.now()).length;
}

export async function flushOfflineAssessmentMutations(
  principalId: string,
  sender: (mutation: OfflineAssessmentMutation) => Promise<void>,
  options: { retainConflicts?: boolean } = {},
): Promise<OfflineSyncResult> {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const key = await getOrCreateKey(database, principal);
  const records = (await recordsForPrincipal<StoredMutation>(database, mutationsStore, principal))
    .filter((item) => item.expiresAt > Date.now())
    .sort((left, right) => left.updatedAt - right.updatedAt);
  let completed = 0;
  let conflicts = 0;
  for (const stored of records) {
    const mutation = await decryptPayload<OfflineAssessmentMutation>(key, principal, stored.id, stored);
    try {
      await sender(mutation);
      await removeFlushedMutation(database, stored);
      completed += 1;
    } catch (error) {
      if (statusFor(error) === 409) {
        // A stale write cannot become valid by replaying the same payload. The
        // editor keeps the local draft and reconciles it against the latest
        // server version before issuing a fresh mutation.
        if (!options.retainConflicts) await removeFlushedMutation(database, stored);
        conflicts += 1;
      }
      if (statusFor(error) === 0 || statusFor(error) >= 500) break;
    }
  }
  const remaining = (await recordsForPrincipal<StoredMutation>(database, mutationsStore, principal)).length;
  database.close();
  notifyOfflineStateChanged();
  return { completed, conflicts, remaining };
}

async function removeFlushedMutation(database: IDBDatabase, flushed: StoredMutation) {
  const transaction = database.transaction(mutationsStore, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(mutationsStore);
  const current = await request<StoredMutation | undefined>(store.get(flushed.id));
  // The encryption nonce identifies the queued revision, even for same-ms edits.
  const flushedIv = new Uint8Array(flushed.iv);
  if (current?.principal === flushed.principal) {
    const currentIv = new Uint8Array(current.iv);
    if (currentIv.length === flushedIv.length && currentIv.every((byte, index) => byte === flushedIv[index])) {
      store.delete(flushed.id);
    }
  }
  await done;
}

export async function pendingOfflineRecoveryDrafts(principalId: string) {
  const database = await openDatabase();
  try {
    const principal = await hashValue(principalId);
    const records = await recordsForPrincipal<StoredRecord>(database, recordsStore, principal);
    return records.filter((record) => record.kind !== "assessment-working-set" && record.expiresAt > Date.now()).length;
  } finally {
    database.close();
  }
}

export async function clearPipelineOfflineData() {
  if (!("indexedDB" in window)) return;
  try {
    const database = await openDatabase();
    const transaction = database.transaction([keysStore, recordsStore, mutationsStore, activeStore], "readwrite");
    transaction.objectStore(keysStore).clear();
    transaction.objectStore(recordsStore).clear();
    transaction.objectStore(mutationsStore).clear();
    transaction.objectStore(activeStore).clear();
    await transactionDone(transaction);
    database.close();
  } catch {
    // Database deletion below remains the fallback for a damaged local store.
  }
  await new Promise<void>((resolve) => {
    const deletion = window.indexedDB.deleteDatabase(databaseName);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => resolve();
    deletion.onblocked = () => resolve();
  });
  broadcastOfflineDataCleared();
  notifyOfflineStateChanged();
}

function openDatabase() {
  if (!("indexedDB" in window) || !window.crypto?.subtle) {
    return Promise.reject(new Error("Encrypted offline storage is unavailable in this browser."));
  }
  return new Promise<IDBDatabase>((resolve, reject) => {
    const opening = window.indexedDB.open(databaseName, databaseVersion);
    opening.onupgradeneeded = () => {
      const database = opening.result;
      if (!database.objectStoreNames.contains(keysStore)) database.createObjectStore(keysStore, { keyPath: "id" });
      if (!database.objectStoreNames.contains(recordsStore)) {
        const records = database.createObjectStore(recordsStore, { keyPath: "id" });
        records.createIndex("principal", "principal");
      }
      if (!database.objectStoreNames.contains(mutationsStore)) {
        const mutations = database.createObjectStore(mutationsStore, { keyPath: "id" });
        mutations.createIndex("principal", "principal");
      }
      if (!database.objectStoreNames.contains(activeStore)) {
        database.createObjectStore(activeStore, { keyPath: "id" });
      }
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error ?? new Error("Offline storage could not be opened."));
  });
}

async function getOrCreateKey(database: IDBDatabase, principal: string) {
  const existing = await request<StoredKey | undefined>(database.transaction(keysStore).objectStore(keysStore).get(principal));
  if (existing?.key) return existing.key;
  const key = await window.crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
  const transaction = database.transaction(keysStore, "readwrite");
  const done = transactionDone(transaction);
  const store = transaction.objectStore(keysStore);
  // Key generation can overlap across tabs; select one key atomically before encryption.
  const current = await request<StoredKey | undefined>(store.get(principal));
  if (current?.key) {
    await done;
    return current.key;
  }
  store.put({ id: principal, key, createdAt: Date.now() } satisfies StoredKey);
  await done;
  return key;
}

async function encryptPayload(key: CryptoKey, principal: string, record: string, value: unknown): Promise<EncryptedPayload> {
  return encryptBytes(key, principal, record, encode(JSON.stringify(value)));
}

async function encryptBytes(key: CryptoKey, principal: string, record: string, bytes: BufferSource): Promise<EncryptedPayload> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encode(`${principal}:${record}`) }, key, bytes,
  );
  return { iv: iv.buffer, ciphertext };
}

function decryptBytes(key: CryptoKey, principal: string, record: string, value: EncryptedPayload) {
  return window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: value.iv, additionalData: encode(`${principal}:${record}`) }, key, value.ciphertext,
  );
}

async function decryptPayload<T>(key: CryptoKey, principal: string, record: string, value: EncryptedPayload) {
  return JSON.parse(new TextDecoder().decode(await decryptBytes(key, principal, record, value))) as T;
}

export async function saveOfflineReferralDraft(principalId: string, draftKey: string, payload: Blob) {
  const database = await openDatabase();
  try {
    const principal = await hashValue(principalId);
    const key = await getOrCreateKey(database, principal);
    const sessionId = await currentOfflineRecoverySessionId();
    const id = await recordId(principal, "referral-draft", `${draftKey}:${sessionId}`);
    const encrypted = await encryptBytes(key, principal, id, await payload.arrayBuffer());
    const now = Date.now();
    const transaction = database.transaction(recordsStore, "readwrite");
    transaction.objectStore(recordsStore).put({
      id, principal, kind: "referral-draft", sessionId, updatedAt: now, expiresAt: now + expiryMs, ...encrypted,
    } satisfies StoredRecord);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function loadOfflineReferralDrafts(principalId: string) {
  const database = await openDatabase();
  try {
    const principal = await hashValue(principalId);
    const key = await getOrCreateKey(database, principal);
    const records = await recordsForPrincipal<StoredRecord>(database, recordsStore, principal);
    const decoded = await Promise.allSettled(records
      .filter((record) => record.kind === "referral-draft" && record.expiresAt > Date.now())
      .map(async (record) => ({
        bytes: await decryptBytes(key, principal, record.id, record),
        updatedAt: record.updatedAt,
      })));
    const readable = decoded.filter((result): result is PromiseFulfilledResult<{ bytes: ArrayBuffer; updatedAt: number }> => result.status === "fulfilled")
      .map((result) => result.value);
    if (!readable.length) {
      const failure = decoded.find((result): result is PromiseRejectedResult => result.status === "rejected");
      if (failure) throw failure.reason;
    }
    return readable.sort((left, right) => right.updatedAt - left.updatedAt).map((record) => record.bytes);
  } finally {
    database.close();
  }
}

export async function removeOfflineReferralDraft(principalId: string, draftKey: string) {
  const database = await openDatabase();
  try {
    const principal = await hashValue(principalId);
    const id = await recordId(principal, "referral-draft", `${draftKey}:${await currentOfflineRecoverySessionId()}`);
    const transaction = database.transaction(recordsStore, "readwrite");
    transaction.objectStore(recordsStore).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

async function removeExpired(database: IDBDatabase, principal: string) {
  const now = Date.now();
  for (const storeName of [recordsStore, mutationsStore]) {
    const records = await recordsForPrincipal<StoredRecord | StoredMutation>(database, storeName, principal);
    const expired = records.filter((item) => item.expiresAt <= now);
    if (!expired.length) continue;
    const transaction = database.transaction(storeName, "readwrite");
    for (const item of expired) transaction.objectStore(storeName).delete(item.id);
    await transactionDone(transaction);
  }
  const active = await request<StoredActiveAssessment | undefined>(database.transaction(activeStore).objectStore(activeStore).get(activeAssessmentKey));
  if (active?.principal === principal && active.expiresAt <= now) {
    await deleteWorkingSet(database, active.recordId);
  }
}

async function enforceActivePrincipal(database: IDBDatabase, principal: string) {
  const active = await request<StoredActiveAssessment | undefined>(database.transaction(activeStore).objectStore(activeStore).get(activeAssessmentKey));
  if (!active || active.principal === principal) return;
  const transaction = database.transaction([keysStore, recordsStore, mutationsStore, activeStore], "readwrite");
  transaction.objectStore(keysStore).clear();
  transaction.objectStore(recordsStore).clear();
  transaction.objectStore(mutationsStore).clear();
  transaction.objectStore(activeStore).clear();
  await transactionDone(transaction);
  broadcastOfflineDataCleared();
  notifyOfflineStateChanged();
}

async function deleteWorkingSet(database: IDBDatabase, recordIdValue: string) {
  const transaction = database.transaction([recordsStore, activeStore], "readwrite");
  transaction.objectStore(recordsStore).delete(recordIdValue);
  const active = await request<StoredActiveAssessment | undefined>(transaction.objectStore(activeStore).get(activeAssessmentKey));
  if (active?.recordId === recordIdValue) transaction.objectStore(activeStore).delete(activeAssessmentKey);
  await transactionDone(transaction);
}

function createWorkingSet(draft: PipelineAssessmentDraft, returnPath: string, editable: boolean): OfflineAssessmentWorkingSet {
  const sectionByField = new Map(assessmentToolFieldDefinitions.map((definition) => [definition.key, definition.section]));
  const requiredByField = new Map(assessmentToolFieldDefinitions.map((definition) => [definition.key, definition.required_for_completion]));
  return {
    schema: 1,
    savedAt: new Date().toISOString(),
    returnPath: normalizeReturnPath(returnPath),
    editable,
    draft,
    sections: assessmentInterviewSections.map((section) => ({ ...section })),
    questions: assessmentInterviewQuestions.map((question) => ({
      ...question,
      options: question.options?.map((option) => ({ ...option })),
      showWhen: question.showWhen ? { ...question.showWhen } : undefined,
      requiredWhen: question.requiredWhen ? { ...question.requiredWhen } : undefined,
      label: assessmentInterviewFieldLabel(question.field),
      section: sectionByField.get(question.field) ?? "provenance_qc",
      required: requiredByField.get(question.field) ?? false,
    })),
  };
}

function normalizeReturnPath(value: string) {
  if (!value.startsWith("/") || value.startsWith("//") || value.includes("\n") || value.includes("\r")) return "/";
  return value.slice(0, 2_000);
}

function recordsForPrincipal<T>(database: IDBDatabase, storeName: string, principal: string) {
  return request<T[]>(database.transaction(storeName).objectStore(storeName).index("principal").getAll(principal));
}

function request<T = IDBValidKey>(value: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error ?? new Error("Offline storage operation failed."));
  });
}

function transactionDone(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("Offline storage transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("Offline storage transaction was aborted."));
  });
}

async function hashValue(value: string) {
  const digest = await window.crypto.subtle.digest("SHA-256", encode(value));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function recordId(principal: string, kind: string, key: string) {
  return hashValue(`${principal}:${kind}:${key}`);
}

function encode(value: string) {
  return new TextEncoder().encode(value);
}

function statusFor(error: unknown) {
  if (!error || typeof error !== "object" || !("status" in error)) return 0;
  return typeof error.status === "number" ? error.status : 0;
}

function notifyOfflineStateChanged() {
  window.dispatchEvent(new CustomEvent("pipeline:offline-state-changed"));
}

function broadcastOfflineDataCleared() {
  if (!("BroadcastChannel" in window)) return;
  const channel = new BroadcastChannel("pipeline-offline-control");
  channel.postMessage({ type: "PIPELINE_OFFLINE_DATA_CLEARED" });
  channel.close();
}

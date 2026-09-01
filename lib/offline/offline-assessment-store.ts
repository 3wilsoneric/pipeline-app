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

type EncryptedPayload = {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

type StoredKey = { id: string; key: CryptoKey; createdAt: number };
type StoredRecord = EncryptedPayload & {
  id: string;
  principal: string;
  kind: "assessment-draft" | "assessment-working-set";
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
  const id = await recordId(principal, "assessment-draft", assessmentId);
  const encrypted = await encryptPayload(key, principal, id, draft);
  const now = Date.now();
  await request(database.transaction(recordsStore, "readwrite").objectStore(recordsStore).put({
    id,
    principal,
    kind: "assessment-draft",
    updatedAt: now,
    expiresAt: now + expiryMs,
    ...encrypted,
  } satisfies StoredRecord));
  database.close();
}

export async function loadOfflineAssessmentDraft(principalId: string, assessmentId: string) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const id = await recordId(principal, "assessment-draft", assessmentId);
  const stored = await request<StoredRecord | undefined>(database.transaction(recordsStore).objectStore(recordsStore).get(id));
  if (!stored || stored.expiresAt <= Date.now()) {
    if (stored) await request(database.transaction(recordsStore, "readwrite").objectStore(recordsStore).delete(id));
    database.close();
    return null;
  }
  const key = await getOrCreateKey(database, principal);
  const value = await decryptPayload<PipelineAssessmentDraft>(key, principal, id, stored);
  database.close();
  return value;
}

export async function removeOfflineAssessmentDraft(principalId: string, assessmentId: string) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  const id = await recordId(principal, "assessment-draft", assessmentId);
  await request(database.transaction(recordsStore, "readwrite").objectStore(recordsStore).delete(id));
  database.close();
}

export async function saveOfflineAssessmentWorkingSet(
  principalId: string,
  draft: PipelineAssessmentDraft,
  returnPath: string,
  options: { editable: boolean },
) {
  const database = await openDatabase();
  const principal = await hashValue(principalId);
  await enforceActivePrincipal(database, principal);
  const key = await getOrCreateKey(database, principal);
  const id = await recordId(principal, "assessment-working-set", draft.assessmentId);
  const workingSet = createWorkingSet(draft, returnPath, options.editable);
  const encrypted = await encryptPayload(key, principal, id, workingSet);
  const now = Date.now();
  const previousActive = await request<StoredActiveAssessment | undefined>(database.transaction(activeStore).objectStore(activeStore).get(activeAssessmentKey));
  const transaction = database.transaction([recordsStore, activeStore], "readwrite");
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
  await request(database.transaction(mutationsStore, "readwrite").objectStore(mutationsStore).put({
    id,
    principal,
    updatedAt: now,
    expiresAt: now + expiryMs,
    ...encrypted,
  } satisfies StoredMutation));
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
      await request(database.transaction(mutationsStore, "readwrite").objectStore(mutationsStore).delete(stored.id));
      completed += 1;
    } catch (error) {
      if (statusFor(error) === 409) conflicts += 1;
      if (statusFor(error) === 0 || statusFor(error) >= 500) break;
    }
  }
  const remaining = (await recordsForPrincipal<StoredMutation>(database, mutationsStore, principal)).length;
  database.close();
  notifyOfflineStateChanged();
  return { completed, conflicts, remaining };
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
  await request(database.transaction(keysStore, "readwrite").objectStore(keysStore).put({ id: principal, key, createdAt: Date.now() } satisfies StoredKey));
  return key;
}

async function encryptPayload(key: CryptoKey, principal: string, record: string, value: unknown): Promise<EncryptedPayload> {
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await window.crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encode(`${principal}:${record}`) },
    key,
    encode(JSON.stringify(value)),
  );
  return { iv: iv.buffer, ciphertext };
}

async function decryptPayload<T>(key: CryptoKey, principal: string, record: string, value: EncryptedPayload) {
  const plaintext = await window.crypto.subtle.decrypt(
    { name: "AES-GCM", iv: value.iv, additionalData: encode(`${principal}:${record}`) },
    key,
    value.ciphertext,
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as T;
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

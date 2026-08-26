"use client";

import type { PipelineAssessmentDraft } from "@/lib/pipeline/user-workspace-state-types";

const databaseName = "pipeline-offline-v1";
const databaseVersion = 1;
const keysStore = "keys";
const recordsStore = "records";
const mutationsStore = "mutations";
const expiryMs = 7 * 24 * 60 * 60 * 1_000;

type EncryptedPayload = {
  iv: ArrayBuffer;
  ciphertext: ArrayBuffer;
};

type StoredKey = { id: string; key: CryptoKey; createdAt: number };
type StoredRecord = EncryptedPayload & {
  id: string;
  principal: string;
  kind: "assessment-draft";
  updatedAt: number;
  expiresAt: number;
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
  await new Promise<void>((resolve) => {
    const deletion = window.indexedDB.deleteDatabase(databaseName);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => resolve();
    deletion.onblocked = () => resolve();
  });
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

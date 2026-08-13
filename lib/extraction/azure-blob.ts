import "server-only";

import { DefaultAzureCredential } from "@azure/identity";
import {
  BlobSASPermissions,
  BlobServiceClient,
  generateBlobSASQueryParameters,
  SASProtocol,
  type UserDelegationKey,
} from "@azure/storage-blob";

import type { CreateUploadUrlRequest, CreateUploadUrlResponse } from "./contracts";

export type AzureBlobUploadSigner = {
  createUploadUrls(input: CreateUploadUrlRequest): Promise<CreateUploadUrlResponse>;
  createWriteUrl(container: string, blobPath: string, lifetimeSeconds?: number): Promise<string>;
  createReadUrl(container: string, blobPath: string, lifetimeSeconds?: number): Promise<string>;
  createDeleteUrl(container: string, blobPath: string, lifetimeSeconds?: number): Promise<string>;
  getBlobProperties(container: string, blobPath: string): Promise<BlobProperties>;
  deleteBlob(container: string, blobPath: string): Promise<boolean>;
};

export type BlobProperties = {
  exists: boolean;
  byteSize?: number;
  contentType?: string;
  etag?: string;
};

const serviceVersion = "2023-11-03";
let blobClientCache: { account: string; client: BlobServiceClient } | undefined;
let delegationKeyCache: {
  account: string;
  key: UserDelegationKey;
  expiresAtMs: number;
} | undefined;

export function getAzureBlobUploadSigner(): AzureBlobUploadSigner {
  const account = required("AZURE_STORAGE_ACCOUNT");
  const rawContainer = process.env.AZURE_STORAGE_CONTAINER_RAW?.trim() || "raw";

  return {
    async createUploadUrls(input) {
      if (!input.packet_id || !isUuid(input.packet_id)) {
        throw new Error("A durable packet id is required before signing uploads.");
      }

      const expiresAt = new Date(Date.now() + uploadLifetimeSeconds() * 1000);
      const uploads = await Promise.all(input.files.map(async (file) => {
        const blobPath = `${input.packet_id}/original/${opaqueFileName(file.file_id, file.filename)}`;
        return {
          file_id: file.file_id,
          signed_url: await createSignedBlobUrl(account, rawContainer, blobPath, "cw", expiresAt),
          blob_path: blobPath,
          expires_at: expiresAt.toISOString(),
        };
      }));

      const sentinelPath = `${input.packet_id}/control/upload-complete`;
      return {
        packet_id: input.packet_id,
        uploads,
        sentinel_url: await createSignedBlobUrl(account, rawContainer, sentinelPath, "cw", expiresAt),
      };
    },
    createWriteUrl: (container, blobPath, lifetimeSeconds = 900) =>
      createSignedBlobUrl(account, container, blobPath, "cw", new Date(Date.now() + lifetimeSeconds * 1000)),
    createReadUrl: (container, blobPath, lifetimeSeconds = 300) =>
      createSignedBlobUrl(account, container, blobPath, "r", new Date(Date.now() + lifetimeSeconds * 1000)),
    createDeleteUrl: (container, blobPath, lifetimeSeconds = 300) =>
      createSignedBlobUrl(account, container, blobPath, "d", new Date(Date.now() + lifetimeSeconds * 1000)),
    async getBlobProperties(container, blobPath) {
      assertSafeBlobPart(container, "container");
      assertSafeBlobPath(blobPath);
      try {
        const properties = await getBlobServiceClient(account)
          .getContainerClient(container)
          .getBlobClient(blobPath)
          .getProperties();
        return {
          exists: true,
          byteSize: properties.contentLength,
          contentType: properties.contentType,
          etag: properties.etag,
        };
      } catch (error) {
        const status = azureStatus(error);
        if (status === 404) return { exists: false };
        throw new BlobStorageError("blob_properties_failed", status);
      }
    },
    async deleteBlob(container, blobPath) {
      assertSafeBlobPart(container, "container");
      assertSafeBlobPath(blobPath);
      try {
        const result = await getBlobServiceClient(account)
          .getContainerClient(container)
          .getBlobClient(blobPath)
          .deleteIfExists({ deleteSnapshots: "include" });
        return result.succeeded;
      } catch (error) {
        throw new BlobStorageError("blob_delete_failed", azureStatus(error));
      }
    },
  };
}

export class BlobStorageError extends Error {
  constructor(public readonly code: string, public readonly status?: number) {
    super(code);
    this.name = "BlobStorageError";
  }
}

async function createSignedBlobUrl(
  account: string,
  container: string,
  blobPath: string,
  permissions: string,
  expiresAt: Date,
) {
  assertSafeBlobPart(container, "container");
  assertSafeBlobPath(blobPath);
  const base = `https://${account}.blob.core.windows.net/${container}/${blobPath.split("/").map(encodeURIComponent).join("/")}`;
  const startsAt = new Date(Date.now() - 5 * 60 * 1000);
  const values = {
    containerName: container,
    blobName: blobPath,
    permissions: BlobSASPermissions.parse(permissions),
    protocol: SASProtocol.Https,
    startsOn: startsAt,
    expiresOn: expiresAt,
    version: serviceVersion,
  };
  const query = generateBlobSASQueryParameters(
    values,
    await getDelegationKey(account, expiresAt),
    account,
  );
  return `${base}?${query.toString()}`;
}

function getBlobServiceClient(account: string) {
  if (blobClientCache?.account === account) {
    return blobClientCache.client;
  }
  const credential = new DefaultAzureCredential({
    managedIdentityClientId: process.env.AZURE_CLIENT_ID?.trim() || undefined,
  });
  const client = new BlobServiceClient(`https://${account}.blob.core.windows.net`, credential);
  blobClientCache = { account, client };
  return client;
}

async function getDelegationKey(account: string, requiredExpiry: Date) {
  const refreshBufferMs = 10 * 60 * 1000;
  if (
    delegationKeyCache?.account === account
    && delegationKeyCache.expiresAtMs > requiredExpiry.getTime() + refreshBufferMs
  ) {
    return delegationKeyCache.key;
  }
  const startsOn = new Date(Date.now() - 5 * 60 * 1000);
  const expiresOn = new Date(Math.max(Date.now() + 2 * 60 * 60 * 1000, requiredExpiry.getTime() + refreshBufferMs));
  try {
    const key = await getBlobServiceClient(account).getUserDelegationKey(startsOn, expiresOn);
    delegationKeyCache = { account, key, expiresAtMs: expiresOn.getTime() };
    return key;
  } catch (error) {
    throw new BlobStorageError("blob_delegation_key_failed", azureStatus(error));
  }
}

function opaqueFileName(fileId: string, filename: string) {
  const safeId = fileId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 96);
  if (!safeId) throw new Error("The upload file id is invalid.");
  const extension = filename.match(/\.([a-zA-Z0-9]{1,10})$/)?.[1]?.toLowerCase() ?? "bin";
  return `${safeId}.${extension}`;
}

function assertSafeBlobPart(value: string, label: string) {
  if (!/^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(value)) {
    throw new Error(`The Azure ${label} is invalid.`);
  }
}

function assertSafeBlobPath(value: string) {
  if (!value || value.length > 900 || value.includes("..") || /[?#\\]/.test(value)) {
    throw new Error("The blob path is invalid.");
  }
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured.`);
  return value;
}

function uploadLifetimeSeconds() {
  const parsed = Number.parseInt(process.env.PIPELINE_UPLOAD_URL_TTL_SECONDS ?? "", 10);
  return Number.isInteger(parsed) ? Math.min(3600, Math.max(300, parsed)) : 900;
}

function azureStatus(error: unknown) {
  if (!error || typeof error !== "object" || !("statusCode" in error)) return undefined;
  const value = (error as { statusCode?: unknown }).statusCode;
  return typeof value === "number" ? value : undefined;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

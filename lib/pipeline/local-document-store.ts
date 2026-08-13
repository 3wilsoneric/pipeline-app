import "server-only";

import { chmod, mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { getReferralStoreReadiness } from "@/lib/pipeline/referral-store";

const sha256Pattern = /^[a-f0-9]{64}$/;
const maxLocalDocumentBytes = 100 * 1024 * 1024;

type LocalDocumentMetadata = {
  schema: 1;
  filename: string;
  contentType: string;
  size: number;
};

export async function writeLocalReferralPacket(input: {
  documentHash: string;
  bytes: Uint8Array;
  filename: string;
  contentType: string;
}) {
  if (!sha256Pattern.test(input.documentHash)) throw new Error("The packet digest is invalid.");
  if (getReferralStoreReadiness().mode !== "local_file") {
    throw new Error("Local packet storage is available only with the local referral store.");
  }
  if (input.bytes.byteLength < 5 || input.bytes.byteLength > maxLocalDocumentBytes) {
    throw new Error("The packet must be between 5 bytes and 100 MB.");
  }

  const root = localDocumentRoot();
  const directory = path.join(/* turbopackIgnore: true */ root, input.documentHash);
  if (!directory.startsWith(`${root}${path.sep}`)) throw new Error("The packet storage path is invalid.");

  const extension = contentTypeExtension(input.contentType);
  const filePath = path.join(/* turbopackIgnore: true */ directory, `original.${extension}`);
  const metadataPath = path.join(/* turbopackIgnore: true */ directory, "metadata.json");
  const nonce = `${process.pid}-${crypto.randomUUID()}`;
  const temporaryFilePath = `${filePath}.${nonce}.tmp`;
  const temporaryMetadataPath = `${metadataPath}.${nonce}.tmp`;
  const metadata: LocalDocumentMetadata = {
    schema: 1,
    filename: safeDownloadName(input.filename, extension),
    contentType: input.contentType,
    size: input.bytes.byteLength,
  };

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700);
  await writeFile(temporaryFilePath, input.bytes, { mode: 0o600 });
  await writeFile(temporaryMetadataPath, JSON.stringify(metadata), { mode: 0o600 });
  await chmod(temporaryFilePath, 0o600);
  await chmod(temporaryMetadataPath, 0o600);
  await rename(temporaryFilePath, filePath);
  await rename(temporaryMetadataPath, metadataPath);

  return { size: metadata.size, filename: metadata.filename, contentType: metadata.contentType };
}

export async function readLocalReferralPacket(documentHash: string) {
  if (!sha256Pattern.test(documentHash)) return null;
  if (getReferralStoreReadiness().mode !== "local_file") return null;

  const root = localDocumentRoot();
  const directory = path.join(/* turbopackIgnore: true */ root, documentHash);
  if (!directory.startsWith(`${root}${path.sep}`)) return null;

  try {
    const documentMetadata = await readMetadata(directory);
    const extension = contentTypeExtension(documentMetadata.contentType);
    const filePath = path.join(/* turbopackIgnore: true */ directory, `original.${extension}`);
    const fileMetadata = await stat(filePath);
    if (!fileMetadata.isFile() || fileMetadata.size < 5 || fileMetadata.size > maxLocalDocumentBytes) return null;
    const bytes = await readFile(filePath);
    return {
      bytes,
      size: fileMetadata.size,
      filename: documentMetadata.filename,
      contentType: documentMetadata.contentType,
    };
  } catch {
    return readLegacyPdf(directory);
  }
}

function localDocumentRoot() {
  const configuredRoot = process.env.PIPELINE_LOCAL_DOCUMENT_ROOT?.trim();
  return configuredRoot
    ? path.resolve(/* turbopackIgnore: true */ configuredRoot)
    : path.join(/* turbopackIgnore: true */ process.cwd(), ".data", "documents");
}

async function readMetadata(directory: string): Promise<LocalDocumentMetadata> {
  const value = JSON.parse(await readFile(path.join(directory, "metadata.json"), "utf8")) as Partial<LocalDocumentMetadata>;
  if (
    value.schema !== 1
    || typeof value.filename !== "string"
    || typeof value.contentType !== "string"
    || typeof value.size !== "number"
  ) {
    throw new Error("Invalid local document metadata.");
  }
  return value as LocalDocumentMetadata;
}

async function readLegacyPdf(directory: string) {
  try {
    const filePath = path.join(/* turbopackIgnore: true */ directory, "original.pdf");
    const metadata = await stat(filePath);
    if (!metadata.isFile() || metadata.size < 5 || metadata.size > maxLocalDocumentBytes) return null;
    const bytes = await readFile(filePath);
    if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") return null;
    return {
      bytes,
      size: metadata.size,
      filename: "referral-packet.pdf",
      contentType: "application/pdf",
    };
  } catch {
    return null;
  }
}

function contentTypeExtension(contentType: string) {
  return {
    "application/pdf": "pdf",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/tiff": "tiff",
    "image/heic": "heic",
  }[contentType] ?? "bin";
}

function safeDownloadName(filename: string, extension: string) {
  const cleaned = filename
    .normalize("NFKC")
    .replace(/[\r\n\0]/g, "")
    .replace(/[\\/]/g, "-")
    .trim()
    .slice(0, 180);
  return cleaned || `referral-packet.${extension}`;
}

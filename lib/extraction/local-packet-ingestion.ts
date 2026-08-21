import "server-only";

import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import type { PDFPageProxy } from "pdfjs-dist/types/src/display/api";

import type { ExtractedField } from "@/lib/extraction/contracts";
import { DocumentProcessingError } from "@/lib/extraction/document-processing";
import { writeLocalReferralPacket } from "@/lib/pipeline/local-document-store";

type PacketPageText = {
  pageNumber: number;
  text: string;
};

type ExtractedValue = {
  value: string;
  confidence: number;
  pageNumber: number;
};

type LocalPacketResult = {
  fields: ExtractedField[];
  pageCount: number;
  ocrPageCount: number;
};

type LocalOcrWorker = {
  recognize: (image: Uint8Array | Buffer) => Promise<{ data: { text: string } }>;
};

const require = createRequire(import.meta.url);
const englishLanguageData = require("@tesseract.js-data/eng") as {
  langPath: string;
};
const minimumEmbeddedTextLength = 80;
const maximumConfiguredOcrPages = 10;
const defaultOcrPages = 3;
const datePattern = /\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-]((?:19|20)\d{2})\b/g;

let ocrWorkerPromise: Promise<LocalOcrWorker> | undefined;
let ocrQueue: Promise<unknown> = Promise.resolve();

export async function ingestLocalPacket(input: {
  packetId: string;
  fileId: string;
  filename: string;
  contentType: string;
  expectedSha256?: string;
  bytes: Uint8Array;
}): Promise<LocalPacketResult & { documentHash: string }> {
  const documentHash = createHash("sha256").update(input.bytes).digest("hex");
  if (input.expectedSha256 && input.expectedSha256 !== documentHash) {
    throw new DocumentProcessingError(
      "uploaded_blob_digest_mismatch",
      409,
      "The uploaded packet does not match the file selected in the browser.",
    );
  }

  validateFileSignature(input.contentType, input.bytes);
  await writeLocalReferralPacket({
    documentHash,
    bytes: input.bytes,
    filename: input.filename,
    contentType: input.contentType,
  });

  const extracted = input.contentType === "application/pdf"
    ? await extractPdf(input.bytes, input.packetId)
    : await extractImage(input.bytes, input.packetId);

  return { ...extracted, documentHash };
}

export function buildLocalIntakeFields(
  pages: PacketPageText[],
  totalPageCount: number,
  packetId: string,
) {
  const name = extractResidentName(pages);
  const birth = extractBirthDateAndAge(pages);
  const gender = extractGender(pages);
  const facility = extractFacility(pages);
  const recordNumber = extractRecordNumber(pages);
  const sourceAdmissionDate = extractAdmissionDate(pages, birth?.date.value);
  const payer = extractPayer(pages);
  const responsiblePerson = extractResponsiblePerson(pages);
  const diagnosis = extractPrimaryDiagnosis(pages);
  const allergies = extractAllergies(pages);
  const legalStatus = extractLegalStatus(pages);
  const summaryParts = [
    `${totalPageCount} source page${totalPageCount === 1 ? "" : "s"} preserved`,
    name ? "identity located" : "identity needs review",
    diagnosis ? "clinical diagnosis located" : "clinical diagnosis needs review",
  ];
  const summary: ExtractedValue = {
    value: `${summaryParts.join("; ")}. Intake values were generated from the first ${pages.length} page${pages.length === 1 ? "" : "s"} and require human confirmation.`,
    confidence: 0.99,
    pageNumber: 1,
  };

  return [
    field("referral.full_name", name, packetId),
    field("referral.date_of_birth", birth?.date, packetId),
    field("referral.age", birth?.age, packetId),
    field("referral.gender", gender, packetId),
    field("referral.referring_facility", facility, packetId),
    field("referral.source_record_number", recordNumber, packetId),
    field("referral.source_admission_date", sourceAdmissionDate, packetId),
    field("referral.payer", payer, packetId),
    field("referral.emergency_contact", responsiblePerson, packetId),
    field("referral.primary_diagnosis", diagnosis, packetId),
    field("referral.allergies", allergies, packetId),
    field("referral.legal_status", legalStatus, packetId),
    field("referral.packet_summary", summary, packetId),
  ];
}

async function extractPdf(bytes: Uint8Array, packetId: string): Promise<LocalPacketResult> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = getDocument({
    data: bytes.slice(),
    wasmUrl: `${path.join(process.cwd(), "node_modules", "pdfjs-dist", "wasm")}${path.sep}`,
  });
  const document = await loadingTask.promise;
  const pageCount = document.numPages;
  const pageLimit = Math.min(pageCount, localOcrPageLimit());
  const pages: PacketPageText[] = [];
  let ocrPageCount = 0;

  try {
    for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const embeddedText = content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      if (embeddedText.length >= minimumEmbeddedTextLength) {
        const embeddedPage = { pageNumber, text: embeddedText };
        if (pageNumber === 1 && !extractResidentName([embeddedPage])) {
          const ocrText = await recognizePdfPage(page);
          pages.push({ pageNumber, text: `${embeddedText}\n${ocrText}`.trim() });
          ocrPageCount += 1;
        } else {
          pages.push(embeddedPage);
        }
      } else {
        pages.push({ pageNumber, text: await recognizePdfPage(page) });
        ocrPageCount += 1;
      }
      page.cleanup();
      if (pageNumber === 1 && hasSufficientIntakeIdentity(pages)) break;
    }
  } finally {
    await loadingTask.destroy();
  }

  return {
    fields: buildLocalIntakeFields(pages, pageCount, packetId),
    pageCount,
    ocrPageCount,
  };
}

async function extractImage(bytes: Uint8Array, packetId: string): Promise<LocalPacketResult> {
  const text = await recognizeImage(bytes);
  const pages = [{ pageNumber: 1, text }];
  return {
    fields: buildLocalIntakeFields(pages, 1, packetId),
    pageCount: 1,
    ocrPageCount: 1,
  };
}

async function recognizePdfPage(page: PDFPageProxy) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const naturalViewport = page.getViewport({ scale: 1 });
  const scale = Math.min(2.25, 1800 / Math.max(1, naturalViewport.width));
  const viewport = page.getViewport({ scale });
  const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
  await page.render({
    canvas: canvas as never,
    canvasContext: canvas.getContext("2d") as never,
    viewport,
  }).promise;
  return recognizeImage(canvas.toBuffer("image/png"));
}

async function recognizeImage(image: Uint8Array | Buffer) {
  const task = ocrQueue.then(async () => {
    const worker = await getOcrWorker();
    const result = await worker.recognize(image);
    return normalizeOcrText(result.data.text);
  });
  ocrQueue = task.catch(() => undefined);
  return task;
}

async function getOcrWorker() {
  if (!ocrWorkerPromise) {
    ocrWorkerPromise = import("tesseract.js").then(async ({ createWorker }) => (
      createWorker("eng", 1, {
        langPath: englishLanguageData.langPath,
        cacheMethod: "none",
      }) as Promise<LocalOcrWorker>
    ));
  }
  return ocrWorkerPromise;
}

function normalizeOcrText(value: string) {
  return value
    .replace(/\r/g, "\n")
    .replace(/[\t ]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function field(fieldKey: string, extracted: ExtractedValue | undefined, packetId: string): ExtractedField {
  const value = extracted?.value.trim() || null;
  const candidateId = `${packetId}-${crypto.randomUUID()}`;
  return {
    field_key: fieldKey,
    version: 1,
    proposed_value: value,
    confidence: value ? extracted?.confidence ?? 0 : 0,
    review_status: "pending",
    ...(extracted ? { source_page_no: extracted.pageNumber } : {}),
    is_conflict: false,
    candidates: value && extracted
      ? [{
          candidate_id: candidateId,
          source: "document_intelligence",
          value,
          confidence: extracted.confidence,
          source_page_no: extracted.pageNumber,
        }]
      : [],
  };
}

function extractResidentName(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const pageLines = lines(page.text);
    for (let index = 0; index < pageLines.length; index += 1) {
      const line = pageLines[index];
      const titled = line.match(/\b(?:Mr|Ms|Mrs|Miss)\.?\s+([A-Za-z][A-Za-z'. -]{1,50}),\s*([A-Za-z][A-Za-z'.-]{1,30})(?:\s+([A-Za-z][A-Za-z'.-]{1,30}))?/i);
      if (titled) {
        const lastName = cleanNamePart(titled[1]);
        const firstName = cleanNamePart(titled[2]);
        const possibleMiddle = cleanNamePart(titled[3] ?? "");
        const middleName = possibleMiddle && possibleMiddle.toLowerCase() !== firstName.toLowerCase() && !isPronoun(possibleMiddle)
          ? ` ${possibleMiddle}`
          : "";
        return { value: `${firstName}${middleName} ${lastName}`, confidence: 0.97, pageNumber: page.pageNumber };
      }

      const labeled = line.match(/(?:resident|patient|client)\s*name\s*[:|-]\s*([A-Za-z][A-Za-z'., -]{2,80})/i);
      if (labeled) {
        const value = normalizeName(labeled[1]);
        if (value) return { value, confidence: 0.94, pageNumber: page.pageNumber };
      }

      if (/\bres(?:i)?dent\s*name\b/i.test(line)) {
        const tableValue = pageLines[index + 1]?.match(/^([A-Za-z][A-Za-z'. -]{1,50}?),\s*([A-Za-z][A-Za-z'.-]{1,30})\b/);
        if (tableValue) {
          return {
            value: `${cleanNamePart(tableValue[2])} ${cleanNamePart(tableValue[1])}`,
            confidence: 0.92,
            pageNumber: page.pageNumber,
          };
        }
      }
    }
  }
  return undefined;
}

function hasSufficientIntakeIdentity(pages: PacketPageText[]) {
  return Boolean(
    extractResidentName(pages)
      && (extractBirthDateAndAge(pages)?.date || extractRecordNumber(pages))
      && extractFacility(pages),
  );
}

function extractBirthDateAndAge(pages: PacketPageText[]) {
  for (const page of pages) {
    const pageLines = lines(page.text);
    for (let index = 0; index < pageLines.length; index += 1) {
      const line = pageLines[index];
      const combined = `${line} ${pageLines[index + 1] ?? ""}`;
      if (!/(date\s*of\s*birth|birth\s*date|\bdob\b|b[irthd]{3,}.*age)/i.test(combined)) continue;
      const candidate = dateWithAge(combined);
      if (candidate) return birthResult(candidate, page.pageNumber, 0.96);
    }

    for (const line of pageLines) {
      const candidate = dateWithAge(line);
      if (candidate && plausibleBirthDate(candidate.isoDate, candidate.age)) {
        return birthResult(candidate, page.pageNumber, 0.88);
      }
    }
  }
  return undefined;
}

function extractGender(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    if (/\bshe\s*[\/]\s*her\b/i.test(page.text)) return { value: "Female", confidence: 0.96, pageNumber: page.pageNumber };
    if (/\bhe\s*[\/]\s*him\b/i.test(page.text)) return { value: "Male", confidence: 0.96, pageNumber: page.pageNumber };
    const explicit = page.text.match(/(?:gender|sex)\s*[:|-]\s*(male|female|nonbinary|non-binary)\b/i);
    if (explicit) return { value: titleCase(explicit[1]), confidence: 0.94, pageNumber: page.pageNumber };
  }
  return undefined;
}

function extractFacility(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const explicit = page.text.match(/(?:referring\s+(?:facility|hospital)|facility|program)\s*[:|-]\s*([^\n|]{3,100})/i);
    if (explicit) return { value: cleanValue(explicit[1]), confidence: 0.9, pageNumber: page.pageNumber };

    const pageLines = lines(page.text);
    const heading = pageLines.findIndex((line) => /admission\s+record/i.test(line));
    if (heading >= 0) {
      const value = pageLines.slice(heading + 1, heading + 5).find((line) => (
        line.length >= 3
        && !/\b(address|tel|fax|phone|resident|admission)\b/i.test(line)
        && !/^\d/.test(line)
      ));
      if (value) return { value: cleanValue(value.replace(/\s*\([^)]{1,12}\)\s*$/, "")), confidence: 0.92, pageNumber: page.pageNumber };
    }
  }
  return undefined;
}

function extractRecordNumber(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const labeled = page.text.match(/(?:resident|medical\s*record|record|mrn)\s*#?\s*[:|-]?\s*(\d{5,14})/i);
    if (labeled) return { value: labeled[1], confidence: 0.94, pageNumber: page.pageNumber };
    const residentLine = lines(page.text).find((line) => /\b(?:Mr|Ms|Mrs|Miss)\.?\b/i.test(line) && /\b\d{6,14}\b/.test(line));
    const trailing = residentLine?.match(/\b(\d{6,14})\b\s*$/);
    if (trailing) return { value: trailing[1], confidence: 0.9, pageNumber: page.pageNumber };
  }
  return undefined;
}

function extractAdmissionDate(pages: PacketPageText[], birthDate?: string): ExtractedValue | undefined {
  for (const page of pages) {
    const pageLines = lines(page.text);
    for (let index = 0; index < pageLines.length; index += 1) {
      const line = pageLines[index];
      if (!/(admission\s*date|admissiono[a-z]*|init\s*adm|orig\s*adm)/i.test(line)) continue;
      const nearby = `${line} ${pageLines[index + 1] ?? ""}`;
      const date = firstDate(nearby, birthDate);
      if (date) return { value: date, confidence: 0.91, pageNumber: page.pageNumber };
    }
  }
  return undefined;
}

function extractPayer(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const match = page.text.match(/primary\s*payer\s*[:|-]?\s*([^\n|]{2,100}?)(?=\s+(?:medicaid|medicare|member|policy)\s*#|\n|\|)/i);
    if (match) return { value: cleanValue(match[1]), confidence: 0.92, pageNumber: page.pageNumber };
  }
  return undefined;
}

function extractResponsiblePerson(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const explicit = page.text.match(/(?:responsible\s+person|emergency\s+contact|conservator\s+name|guardian\s+name)\s*[:|-]\s*([^\n|]{3,100})/i);
    if (explicit) return { value: cleanValue(explicit[1]), confidence: 0.87, pageNumber: page.pageNumber };
    const contactLine = lines(page.text).find((line) => /\bconservator\b/i.test(line) && /[A-Za-z]{2,}/.test(line.replace(/conservator/ig, "")));
    if (contactLine) {
      const beforeRole = contactLine.split(/conservator/i)[0]?.replace(/^[^A-Za-z]+/, "").trim();
      if (beforeRole && beforeRole.length >= 3) return { value: cleanValue(beforeRole), confidence: 0.72, pageNumber: page.pageNumber };
    }
  }
  return undefined;
}

function extractPrimaryDiagnosis(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const explicit = page.text.match(/primary\s+diagnosis\s*[:|-]\s*([^\n|]{3,160})/i);
    if (explicit) return { value: cleanValue(explicit[1]), confidence: 0.92, pageNumber: page.pageNumber };
    const diagnosisLines = lines(page.text);
    const start = diagnosisLines.findIndex((line) => /diagnosis\s+information/i.test(line));
    if (start >= 0) {
      const primary = diagnosisLines.slice(start + 1, start + 18).find((line) => /\bprimary\b/i.test(line));
      if (primary) {
        const cleaned = primary
          .replace(/^\s*[A-Z]?\d[\w.]*\s+/, "")
          .replace(/\b\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4}\b.*$/i, "")
          .replace(/\bprimary\b.*$/i, "");
        if (cleaned.trim().length >= 3) return { value: cleanValue(cleaned), confidence: 0.88, pageNumber: page.pageNumber };
      }
    }
  }
  return undefined;
}

function extractAllergies(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const match = page.text.match(/(?:allerg(?:y|ies)|nkda)\s*[:|-]?\s*([^\n|]{2,140})/i);
    if (!match) continue;
    const value = cleanValue(match[1] || match[0]);
    if (value) return { value, confidence: 0.84, pageNumber: page.pageNumber };
  }
  return undefined;
}

function extractLegalStatus(pages: PacketPageText[]): ExtractedValue | undefined {
  for (const page of pages) {
    const explicit = page.text.match(/(?:legal\s+status|hold\s+type|conservatorship\s+status)\s*[:|-]\s*([^\n|]{2,120})/i);
    if (explicit) return { value: cleanValue(explicit[1]), confidence: 0.86, pageNumber: page.pageNumber };
    if (/\bconservator(?:ship)?\b/i.test(page.text)) {
      return { value: "Conservator listed in packet", confidence: 0.76, pageNumber: page.pageNumber };
    }
    const hold = page.text.match(/\b(5150|5250|5270|voluntary)\b/i);
    if (hold) return { value: hold[1].toUpperCase(), confidence: 0.82, pageNumber: page.pageNumber };
  }
  return undefined;
}

function dateWithAge(value: string) {
  const match = value.match(/\b(0?[1-9]|1[0-2])[\/-](0?[1-9]|[12]\d|3[01])[\/-]((?:19|20)\d{2})\b[^\d]{0,12}(\d{1,3})\b/);
  if (!match) return undefined;
  return { isoDate: isoDate(match[1], match[2], match[3]), age: Number(match[4]) };
}

function birthResult(candidate: { isoDate: string; age: number }, pageNumber: number, confidence: number) {
  return {
    date: { value: candidate.isoDate, confidence, pageNumber },
    age: { value: String(candidate.age), confidence: Math.max(0, confidence - 0.02), pageNumber },
  };
}

function plausibleBirthDate(iso: string, age: number) {
  if (!Number.isInteger(age) || age < 0 || age > 120) return false;
  const year = Number(iso.slice(0, 4));
  const currentYear = new Date().getUTCFullYear();
  return year >= currentYear - 121 && year <= currentYear && Math.abs((currentYear - year) - age) <= 2;
}

function firstDate(value: string, excluded?: string) {
  for (const match of value.matchAll(datePattern)) {
    const date = isoDate(match[1], match[2], match[3]);
    if (date !== excluded) return date;
  }
  return undefined;
}

function isoDate(month: string, day: string, year: string) {
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function lines(value: string) {
  return value.split(/\n+/).map(cleanValue).filter(Boolean);
}

function normalizeName(value: string) {
  const cleaned = cleanValue(value).replace(/\b(?:he\/him|she\/her|they\/them)\b.*$/i, "");
  const comma = cleaned.match(/^([^,]{2,50}),\s*([^,]{2,50})$/);
  if (comma) return `${cleanNamePart(comma[2])} ${cleanNamePart(comma[1])}`.trim();
  const words = cleaned.split(" ").filter((word) => /^[A-Za-z][A-Za-z'.-]*$/.test(word));
  return words.length >= 2 && words.length <= 5 ? words.map(titleCase).join(" ") : undefined;
}

function cleanNamePart(value: string) {
  return value.trim().split(/\s+/).filter(Boolean).map(titleCase).join(" ");
}

function cleanValue(value: string) {
  return value
    .replace(/[_|]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s:;,.\-]+|[\s:;,.\-]+$/g, "")
    .trim();
}

function titleCase(value: string) {
  const normalized = value.trim().toLowerCase();
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : "";
}

function isPronoun(value: string) {
  return ["he", "him", "she", "her", "they", "them"].includes(value.toLowerCase());
}

function localOcrPageLimit() {
  const configured = Number(process.env.PIPELINE_LOCAL_OCR_MAX_PAGES ?? defaultOcrPages);
  if (!Number.isInteger(configured) || configured < 1) return defaultOcrPages;
  return Math.min(configured, maximumConfiguredOcrPages);
}

function validateFileSignature(contentType: string, bytes: Uint8Array) {
  const startsWith = (...signature: number[]) => signature.every((value, index) => bytes[index] === value);
  const valid = contentType === "application/pdf"
    ? Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-"
    : contentType === "image/png"
      ? startsWith(0x89, 0x50, 0x4e, 0x47)
      : contentType === "image/jpeg"
        ? startsWith(0xff, 0xd8, 0xff)
        : contentType === "image/tiff"
          ? startsWith(0x49, 0x49, 0x2a, 0x00) || startsWith(0x4d, 0x4d, 0x00, 0x2a)
          : contentType === "image/heic"
            ? Buffer.from(bytes.subarray(4, 12)).toString("ascii").includes("ftyp")
            : false;

  if (!valid) {
    throw new DocumentProcessingError(
      "uploaded_file_signature_invalid",
      415,
      "The selected file does not match its declared PDF or image type.",
    );
  }
}

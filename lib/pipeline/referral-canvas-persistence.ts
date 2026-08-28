import type { PipelineCommunity } from "@/lib/pipeline/community-config";
import type {
  Referral,
  ReferralCanvasFieldKey,
} from "@/lib/pipeline/referral-types";
import type { ReferralCreateInput, ReferralPatch } from "@/lib/pipeline/referral-store";
import type {
  ReferralCanvasDirtyKey,
  ReferralCanvasPacketField,
} from "@/lib/pipeline/referral-canvas-extraction";

export const persistedCanvasFieldKeys = [
  "name",
  "gender",
  "age",
  "dob",
  "ssn",
  "owner",
  "referralReceived",
  "admissionDate",
  "community",
  "county",
  "referent",
  "responsiblePerson",
  "summary",
  "currentMedications",
] as const satisfies readonly ReferralCanvasFieldKey[];

export type PersistedCanvasFieldKey = (typeof persistedCanvasFieldKeys)[number];
export type ReferralCanvasFields = Record<ReferralCanvasFieldKey, ReferralCanvasPacketField>;

const referralPatchKeyByCanvasField = {
  name: "name",
  gender: "gender",
  age: "reportedAge",
  dob: "dob",
  ssn: "ssn",
  owner: "owner",
  referralReceived: "date",
  admissionDate: "admissionDate",
  community: "community",
  county: "county",
  referent: "source",
  responsiblePerson: "responsiblePerson",
  summary: "note",
  currentMedications: "currentMedications",
} as const satisfies Record<PersistedCanvasFieldKey, keyof ReferralPatch>;

export function isPersistedCanvasFieldKey(
  value: ReferralCanvasDirtyKey,
): value is PersistedCanvasFieldKey {
  return (persistedCanvasFieldKeys as readonly string[]).includes(value);
}

export function referralCanvasValue(referral: Referral, key: PersistedCanvasFieldKey) {
  const values = {
    name: referral.name,
    gender: referral.gender ?? "",
    age: referral.reportedAge ?? "",
    dob: referral.dob,
    ssn: referral.ssn ?? "",
    owner: referral.owner,
    referralReceived: referral.date,
    admissionDate: referral.admissionDate ?? "",
    community: referral.community,
    county: referral.county ?? "",
    referent: referral.source,
    responsiblePerson: referral.responsiblePerson ?? "",
    summary: referral.note,
    currentMedications: referral.currentMedications ?? "",
  } satisfies Record<PersistedCanvasFieldKey, string>;
  return values[key];
}

export function fieldSourcesFromCanvas(fields: ReferralCanvasFields) {
  return Object.fromEntries(
    persistedCanvasFieldKeys
      .map((key) => [key, fields[key].sourceFile?.trim()] as const)
      .filter((entry): entry is readonly [ReferralCanvasFieldKey, string] => Boolean(entry[1])),
  );
}

export function buildReferralCanvasPatch(input: {
  keys: ReadonlySet<ReferralCanvasDirtyKey>;
  fields: ReferralCanvasFields;
  conserved: "yes" | "no" | "";
  tags: string[];
  requirements: Referral["requirements"];
  packet?: { name: string; size: number; hash: string };
}): ReferralPatch {
  const patch: ReferralPatch = {};
  let fieldChanged = false;
  for (const key of persistedCanvasFieldKeys) {
    if (!input.keys.has(key)) continue;
    fieldChanged = true;
    (patch as Record<string, unknown>)[referralPatchKeyByCanvasField[key]] = input.fields[key].value;
  }
  if (fieldChanged) patch.fieldSources = fieldSourcesFromCanvas(input.fields);
  if (input.keys.has("conserved")) patch.conserved = input.conserved;
  if (input.keys.has("tags")) patch.tags = input.tags;
  if (input.keys.has("documents")) patch.requirements = input.requirements;
  if (input.keys.has("initialPacket") && input.packet) {
    patch.documentName = input.packet.name;
    patch.documentSizeBytes = input.packet.size;
    patch.documentHash = input.packet.hash;
    patch.documentStatus = "Missing";
  }
  return patch;
}

export function buildReferralCanvasCreateInput(input: {
  fields: ReferralCanvasFields;
  conserved: "yes" | "no" | "";
  community: PipelineCommunity;
  tags: string[];
  requirements: Referral["requirements"];
  createdAt: string;
  document?: { name: string; size: number; hash?: string };
}): ReferralCreateInput {
  const { fields } = input;
  return {
    name: fields.name.value.trim() || "Pending packet review",
    date: fields.referralReceived.value.trim() || input.createdAt.slice(0, 10),
    stage: "New",
    community: input.community,
    source: fields.referent.value.trim() || "Referral packet",
    priority: "standard",
    tags: input.tags,
    documentName: input.document?.name ?? "",
    documentSizeBytes: input.document?.size,
    documentHash: input.document?.hash,
    documentStatus: "Missing",
    owner: fields.owner.value.trim() || "Unassigned",
    note: fields.summary.value.trim(),
    createdAt: input.createdAt,
    dob: fields.dob.value.trim(),
    gender: fields.gender.value.trim(),
    reportedAge: fields.age.value.trim(),
    ssn: fields.ssn.value.trim(),
    admissionDate: fields.admissionDate.value.trim(),
    county: fields.county.value.trim(),
    responsiblePerson: fields.responsiblePerson.value.trim(),
    currentMedications: fields.currentMedications.value.trim(),
    conserved: input.conserved,
    fieldSources: fieldSourcesFromCanvas(fields),
    phone: "",
    email: "",
    payer: "",
    requirements: input.requirements,
  };
}

import "server-only";
import { createHash } from "node:crypto";
import { getClinicalClientDirectoryIndex } from "./clinical-client-directory-index";
import { getClinicalClient, type ClinicalResidentResponse } from "./clinical-data";
import { clientProfileBirthDates } from "@/lib/pipeline/client-profile-presentation";

const nameKey = (name: string) => name.normalize("NFKD").toLowerCase().match(/[a-z0-9]+/g)?.join(" ") ?? "";

/** Read-only supplementation of a current client, never a workspace or identity-link write. */
export async function supplementResidentBirthDate(request: Request, current: ClinicalResidentResponse): Promise<ClinicalResidentResponse> {
  if (current.resident.date_of_birth || !current.resident.resident_number || current.freshness.status !== "fresh") return current;
  // A missing optional demographic must not hold the chart behind an upstream outage.
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      loadBirthDate(request, current).catch(() => current),
      new Promise<ClinicalResidentResponse>((resolve) => { timeout = setTimeout(() => resolve(current), 1_500); }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function loadBirthDate(request: Request, current: ClinicalResidentResponse): Promise<ClinicalResidentResponse> {
  // Directory reuse is bound to the full operator session and upstream, not a name or role.
  const accessKey = createHash("sha256").update(JSON.stringify([
    process.env.PIPELINE_ALAMO_API_BASE_URL, request.headers.get("authorization"), request.headers.get("cookie"),
  ])).digest("hex");
  const index = await getClinicalClientDirectoryIndex(request, `demographics:${accessKey}`);
  if (index.freshUntil <= Date.now()) return current;
  const resident = current.resident;
  const client = index.byResidentNumber.get(resident.resident_number!.trim());
  if (!client || !nameKey(resident.display_name) || nameKey(client.display_name) !== nameKey(resident.display_name)) return current;
  const detail = await getClinicalClient(request, client.canonical_client_id);
  if (detail.freshness.status !== "fresh" || detail.client.canonical_client_id !== client.canonical_client_id
    || !detail.client.resident_numbers.includes(resident.resident_number!.trim())
    || nameKey(detail.client.display_name) !== nameKey(resident.display_name)) return current;
  const dates = clientProfileBirthDates(detail.client);
  if (dates.length !== 1 || !dates[0] || dates[0] > current.data_as_of.slice(0, 10)) return current;
  return { ...current, resident: { ...resident, date_of_birth: dates[0] } };
}

const missingCommunity = /^(?:unassigned|unknown|not recorded|community not recorded)$/i;

export function canonicalCommunity(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || missingCommunity.test(normalized)) return null;
  const key = normalized.toLowerCase();
  if (key.includes("san pablo")) return "San Pablo";
  if (key.includes("santa clarita") || key.includes("ahmsc")) return "Santa Clarita";
  if (key.includes("turlock")) return "Turlock";
  if (key.includes("victoria")) return "Victoria's House";
  if (key.includes("jcwh") || key.includes("jc wallace")) return "JC Wallace";
  return null;
}

export function admittedProfileEvidence(workspace) {
  const candidates = Array.isArray(workspace?.profile_candidates) ? workspace.profile_candidates : [];
  if (candidates.length !== 1) return null;
  const profile = candidates[0];
  const admissionDate = evidenceDate(profile?.admit_date);
  const community = canonicalCommunity(profile?.community);
  if (!admissionDate || !community) return null;
  return { profile, admissionDate, community };
}

export function resolveImportedWorkspaceCommunity(workspace) {
  return canonicalCommunity(workspace?.community)
    ?? admittedProfileEvidence(workspace)?.community
    ?? "";
}

function evidenceDate(value) {
  const raw = String(value ?? "").trim();
  const iso = /^\d{4}-\d{2}-\d{2}/.test(raw)
    ? raw.slice(0, 10)
    : toIsoDate(raw);
  if (!iso) return null;
  const parsed = new Date(`${iso}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : null;
}

function toIsoDate(value) {
  const match = /^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2}|\d{4})$/.exec(value);
  if (!match) return null;
  const year = match[3].length === 2 ? `20${match[3]}` : match[3];
  return `${year}-${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}`;
}

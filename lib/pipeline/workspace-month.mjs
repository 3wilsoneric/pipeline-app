const workspaceMonthBasisValues = new Set([
  "received_date",
  "record_created_at",
  "source_project_name",
  "unknown",
]);

const monthPatterns = [
  ["01", /(?:^|[^a-z])(?:january|jan)(?=[^a-z]|$)/i],
  ["02", /(?:^|[^a-z])(?:february|feb)(?=[^a-z]|$)/i],
  ["03", /(?:^|[^a-z])march(?=[^a-z]|$)/i],
  ["04", /(?:^|[^a-z])april(?=[^a-z]|$)/i],
  ["05", /(?:^|[^a-z])may(?=[^a-z]|turlock|$)/i],
  ["06", /(?:^|[^a-z])june(?=[^a-z]|$)/i],
  ["07", /(?:^|[^a-z])july(?=[^a-z]|$)/i],
  ["08", /(?:^|[^a-z])(?:august|aug)(?=[^a-z]|$)/i],
  ["09", /(?:^|[^a-z])(?:september|septemeber|sept|sep)(?=[^a-z]|$)/i],
  ["10", /(?:^|[^a-z])(?:october|oct)(?=[^a-z]|$)/i],
  ["11", /(?:^|[^a-z])(?:november|nov)(?=[^a-z]|$)/i],
  ["12", /(?:^|[^a-z])(?:december|dec)(?=[^a-z]|$)/i],
];

export function normalizeWorkspaceMonth(value) {
  const normalized = String(value ?? "").trim();
  return /^20\d{2}-(?:0[1-9]|1[0-2])$/.test(normalized) ? normalized : null;
}

export function workspaceMonthFromDate(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) return null;
  const direct = normalizeWorkspaceMonth(normalized.slice(0, 7));
  if (direct) return direct;
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return `${parsed.getUTCFullYear()}-${String(parsed.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function workspaceMonthFromProjectName(value) {
  const projectName = String(value ?? "").trim();
  if (!projectName) return null;
  const fullYear = projectName.match(/(?:^|\D)(20\d{2})(?=\D|$)/)?.[1];
  const shortYear = projectName.match(/(?:^|[^0-9])(2\d)(?=['’\s]|$)/)?.[1];
  const year = fullYear ?? (shortYear ? `20${shortYear}` : null);
  const month = monthPatterns.find(([, pattern]) => pattern.test(projectName))?.[0] ?? null;
  return year && month ? `${year}-${month}` : null;
}

export function resolveWorkspaceMonth(value) {
  const explicit = normalizeWorkspaceMonth(value?.workspaceMonth);
  const suppliedBasis = workspaceMonthBasisValues.has(value?.workspaceMonthBasis)
    ? value.workspaceMonthBasis
    : null;

  if (value?.workspaceOrigin === "allo" || value?.workspaceOrigin === "import") {
    const sourceMonth = workspaceMonthFromProjectName(value?.sourceProjectName);
    return sourceMonth
      ? { month: sourceMonth, basis: "source_project_name" }
      : { month: null, basis: "unknown" };
  }

  if (explicit) {
    return {
      month: explicit,
      basis: suppliedBasis && suppliedBasis !== "unknown"
        ? suppliedBasis
        : "received_date",
    };
  }

  const receivedMonth = workspaceMonthFromDate(value?.date);
  if (receivedMonth) return { month: receivedMonth, basis: "received_date" };
  const createdMonth = workspaceMonthFromDate(value?.createdAt);
  return createdMonth
    ? { month: createdMonth, basis: "record_created_at" }
    : { month: null, basis: "unknown" };
}

export function workspaceMonthKey(value) {
  return resolveWorkspaceMonth(value).month ?? "unknown";
}

/** An unfinished intake remains visible in subsequent workspace month views. */
export function isWorkspaceCarryoverOpen(value) {
  if (value?.deletedAt || (value?.workspaceStatus && value.workspaceStatus !== "active")) return false;
  if (value?.workspaceOrigin === "allo" || value?.workspaceOrigin === "import") return false;
  if (value?.stage === "Declined" || value?.stage === "Accepted / Admitted") return false;
  if (value?.admissionDecision?.outcome === "declined") return false;
  return !(value?.admissionDecision?.outcome === "accepted" && String(value?.actualAdmissionDate ?? "").trim());
}

export function currentWorkspaceMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles", year: "numeric", month: "2-digit",
  }).formatToParts(now);
  return `${parts.find((part) => part.type === "year").value}-${parts.find((part) => part.type === "month").value}`;
}

export function workspaceDirectoryMonthKeys(value, currentMonth = currentWorkspaceMonth()) {
  const filedMonth = workspaceMonthKey(value);
  const throughMonth = normalizeWorkspaceMonth(currentMonth);
  if (filedMonth === "unknown" || !throughMonth || filedMonth >= throughMonth || !isWorkspaceCarryoverOpen(value)) {
    return [filedMonth];
  }
  const months = [filedMonth];
  const date = new Date(`${filedMonth}-01T00:00:00.000Z`);
  while (true) {
    date.setUTCMonth(date.getUTCMonth() + 1);
    const month = date.toISOString().slice(0, 7);
    if (month > throughMonth) return months;
    months.push(month);
  }
}

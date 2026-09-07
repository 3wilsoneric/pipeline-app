const allowedStatuses = new Set(["owner_approved", "approved"]);
const allowedTotalMetrics = new Set(["hotspots", "criticalHotspots", "controlPlaneHotspots"]);

export function evaluateComplexityDisposition(failures, disposition) {
  if (!disposition) return missingDisposition(failures);
  const validationErrors = validateDisposition(disposition);
  const warnings = dispositionWarnings(disposition);
  const canApply = disposition.status === "approved" && validationErrors.length === 0;
  const { applied, remaining } = partitionFailures(failures, disposition, canApply);
  if (canApply) warnings.push(...staleCeilingWarnings(failures, disposition));

  return {
    status: disposition.status,
    applied,
    remaining,
    validationErrors,
    warnings,
  };
}

function missingDisposition(failures) {
  return {
    status: "missing",
    applied: [],
    remaining: failures,
    validationErrors: [],
    warnings: [],
  };
}

function validateDisposition(disposition) {
  return [
    ...validateDispositionHeader(disposition),
    ...validateFunctionCeilings(disposition.ceilings?.functions),
    ...validateTotalCeilings(disposition.ceilings?.totals),
    ...validateIndependentReview(disposition),
  ];
}

function validateDispositionHeader(disposition) {
  const errors = [];
  if (disposition.schemaVersion !== 1) errors.push("Complexity disposition must use schemaVersion 1.");
  if (!allowedStatuses.has(disposition.status)) errors.push("Complexity disposition status must be owner_approved or approved.");
  if (!disposition.ownerApproval?.approvedBy) errors.push("Complexity disposition requires an owner approver.");
  if (!disposition.ownerApproval?.approvedAt) errors.push("Complexity disposition requires an owner approval timestamp.");
  return errors;
}

function validateFunctionCeilings(ceilings = {}) {
  const errors = [];
  for (const [key, ceiling] of Object.entries(ceilings)) {
    if (!key) errors.push("Complexity function ceiling requires a key.");
    if (!Number.isInteger(ceiling)) errors.push(`Complexity ceiling must be an integer for ${key}.`);
    if (Number.isInteger(ceiling) && ceiling < 1) errors.push(`Complexity ceiling must be positive for ${key}.`);
  }
  return errors;
}

function validateTotalCeilings(ceilings = {}) {
  const errors = [];
  for (const [metric, ceiling] of Object.entries(ceilings)) {
    if (!allowedTotalMetrics.has(metric)) errors.push(`Unsupported complexity total ceiling ${metric}.`);
    if (!Number.isInteger(ceiling)) errors.push(`Complexity total ceiling must be an integer for ${metric}.`);
    if (Number.isInteger(ceiling) && ceiling < 0) errors.push(`Complexity total ceiling cannot be negative for ${metric}.`);
  }
  return errors;
}

function validateIndependentReview(disposition) {
  if (disposition.status !== "approved") return [];
  const errors = [];
  const reviewer = disposition.independentReview?.reviewedBy;
  if (!reviewer) errors.push("Approved complexity disposition requires an independent reviewer.");
  if (!disposition.independentReview?.reviewedAt) errors.push("Approved complexity disposition requires a review timestamp.");
  if (reviewer === disposition.ownerApproval?.approvedBy) errors.push("Complexity disposition reviewer must differ from the owner approver.");
  return errors;
}

function dispositionWarnings(disposition) {
  if (disposition.status === "approved") return [];
  return ["Complexity disposition has owner approval but awaits independent review; no ceilings were applied."];
}

function partitionFailures(failures, disposition, canApply) {
  const applied = [];
  const remaining = [];
  for (const failure of failures) {
    if (canApply && failureFitsCeiling(failure, disposition)) applied.push(failure);
    else remaining.push(failure);
  }
  return { applied, remaining };
}

function failureFitsCeiling(failure, disposition) {
  const ceiling = ceilingForFailure(failure, disposition);
  return Number.isInteger(ceiling) && failure.current <= ceiling;
}

function ceilingForFailure(failure, disposition) {
  if (failure.kind === "function") return disposition.ceilings?.functions?.[failure.key];
  if (failure.kind === "total") return disposition.ceilings?.totals?.[failure.metric];
  return undefined;
}

function staleCeilingWarnings(failures, disposition) {
  const activeFunctionKeys = new Set(failures.filter(isFunctionFailure).map((failure) => failure.key));
  const activeTotalMetrics = new Set(failures.filter(isTotalFailure).map((failure) => failure.metric));
  return [
    ...staleFunctionWarnings(disposition.ceilings?.functions, activeFunctionKeys),
    ...staleTotalWarnings(disposition.ceilings?.totals, activeTotalMetrics),
  ];
}

function isFunctionFailure(failure) {
  return failure.kind === "function";
}

function isTotalFailure(failure) {
  return failure.kind === "total";
}

function staleFunctionWarnings(ceilings = {}, activeKeys) {
  const warnings = [];
  for (const key of Object.keys(ceilings)) {
    if (!activeKeys.has(key)) warnings.push(`Approved function ceiling is now stale and should be removed or lowered: ${key}.`);
  }
  return warnings;
}

function staleTotalWarnings(ceilings = {}, activeMetrics) {
  const warnings = [];
  for (const metric of Object.keys(ceilings)) {
    if (!activeMetrics.has(metric)) warnings.push(`Approved total ceiling is now stale and should be removed or lowered: ${metric}.`);
  }
  return warnings;
}

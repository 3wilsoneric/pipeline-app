export type ExtractionFailureDisposition = {
  status: "queued" | "dead_letter";
  backoffSeconds: number;
};

export function getExtractionFailureDisposition(
  attemptCount: number,
  maxAttempts: number,
  retryable: boolean,
): ExtractionFailureDisposition {
  const attempt = boundedInteger(attemptCount, 0, 20);
  const maximum = boundedInteger(maxAttempts, 1, 20);
  const deadLetter = !retryable || attempt >= maximum;
  return {
    status: deadLetter ? "dead_letter" : "queued",
    backoffSeconds: deadLetter ? 0 : Math.min(3600, 30 * 2 ** Math.max(0, attempt - 1)),
  };
}

export function leaseCanBeClaimed(
  status: string,
  nextAttemptAt: number,
  leaseExpiresAt: number | null,
  now: number,
) {
  if (status === "queued") return nextAttemptAt <= now;
  return status === "running" && leaseExpiresAt !== null && leaseExpiresAt <= now;
}

export function isAllowedExtractionTransition(from: string, to: string) {
  const transitions: Record<string, string[]> = {
    queued: ["running", "cancelled"],
    running: ["queued", "succeeded", "dead_letter", "cancelled"],
    failed: ["queued", "dead_letter"],
    dead_letter: ["queued"],
    succeeded: [],
    cancelled: ["queued"],
  };
  return transitions[from]?.includes(to) ?? false;
}

function boundedInteger(value: number, minimum: number, maximum: number) {
  return Number.isInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : minimum;
}

export type UsageMinute = { minute: string; interactions: number };
export type UsageBatch = { sessionId: string; samples: UsageMinute[] };

export function parseUsageBatch(value: unknown, now = Date.now()): UsageBatch | null {
  if (!value || typeof value !== "object") return null;
  const batch = value as UsageBatch;
  if (typeof batch.sessionId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(batch.sessionId)
    || !Array.isArray(batch.samples) || !batch.samples.length || batch.samples.length > 5) return null;
  const seen = new Set<string>();
  const samples: UsageMinute[] = [];
  for (const sample of batch.samples) {
    if (!sample || typeof sample.minute !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/.test(sample.minute)) return null;
    const time = Date.parse(sample.minute);
    if (!Number.isFinite(time) || time < now - 5 * 60_000 || time > now || new Date(time).toISOString() !== sample.minute
      || !Number.isInteger(sample.interactions) || sample.interactions < 0 || sample.interactions > 600 || seen.has(sample.minute)) return null;
    seen.add(sample.minute);
    samples.push({ minute: sample.minute, interactions: sample.interactions });
  }
  return { sessionId: batch.sessionId, samples };
}

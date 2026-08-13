export function isValidHttpByteRange(value: string) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  if (!match || (!match[1] && !match[2])) return false;
  const start = parseOptionalInteger(match[1]);
  const end = parseOptionalInteger(match[2]);
  if (start === false || end === false) return false;
  return start === null || end === null || start <= end;
}

function parseOptionalInteger(value: string): number | null | false {
  if (!value) return null;
  if (!/^\d+$/.test(value)) return false;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : false;
}

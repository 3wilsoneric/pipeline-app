export function formatPhoneForEntry(value: string) {
  const trimmed = value.trim();
  if (!/^[+\d\s().-]+$/.test(trimmed)) return trimmed;
  const digits = trimmed.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return trimmed;
  const formatted = `(${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return digits.length === 11 ? `+1 ${formatted}` : formatted;
}

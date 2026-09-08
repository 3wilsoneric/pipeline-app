export function normalizeCalendarDate(value: string | undefined | null) {
  const input = value?.trim();
  if (!input) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input);
  const local = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(input);
  const match = iso ?? local;
  if (!match) return null;

  const year = Number(iso ? match[1] : match[3]);
  const month = Number(iso ? match[2] : match[1]);
  const day = Number(iso ? match[3] : match[2]);
  if (year < 1 || year > 9_999 || month < 1 || month > 12) return null;
  const maximumDay = [31, leapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (day < 1 || day > maximumDay) return null;

  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function leapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

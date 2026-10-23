const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** "2026-10-22" → "Oct 22" with no timezone shift (plain NBA game date). */
export function formatPlainDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}

/** UTC timestamp → "Oct 23" in the browser's local time. */
export function formatLocalDate(isoUtc: string): string {
  const dt = new Date(isoUtc);
  if (Number.isNaN(dt.getTime())) return "";
  return `${MONTHS[dt.getMonth()]} ${dt.getDate()}`;
}

/** Browser-local month as YYYY-MM. */
export function clientMonthKey(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

/** "2026-11" → "Nov". */
export function monthShort(key: string): string {
  const m = Number(key.split("-")[1]);
  return MONTHS[m - 1] ?? key;
}

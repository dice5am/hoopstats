import { formatShortName } from "@/lib/formatName";

/** Unicode-aware fold: NFD + strip diacritics + lowercase. */
export function foldDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Match query against full name or short form (`F. Lastname`).
 * Unicode diacritics are folded so e.g. "doncic" matches "Dončić".
 * Last-name substrings already match via the folded full name.
 */
export function nameMatches(fullName: string, query: string): boolean {
  const q = foldDiacritics(query.trim());
  if (!q) return true;
  if (foldDiacritics(fullName).includes(q)) return true;
  return foldDiacritics(formatShortName(fullName)).includes(q);
}

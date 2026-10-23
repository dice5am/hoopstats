/**
 * Short display names for dense UI (tables, boards, chips, search hits).
 *
 * Rules:
 * - First whitespace token → initial + "." (e.g. "Luka" → "L.")
 * - Last-name token = last whitespace token after stripping a trailing
 *   generational suffix (Jr./Jr/Sr./Sr/II/III/IV). Suffix stays attached
 *   to the last name when present (prefer "M. Porter Jr.").
 * - Multi-part / hyphenated first names use only the first initial of the
 *   first token ("Karl-Anthony Towns" → "K. Towns").
 * - Multi-part last names without a suffix still use the last whitespace
 *   token only (documented tradeoff for density).
 * - Single-token names are returned unchanged.
 *
 * Keep `fullName` for PlayerExplorer detail headers / titles.
 */
const NAME_SUFFIXES = new Set([
  "jr",
  "jr.",
  "sr",
  "sr.",
  "ii",
  "iii",
  "iv",
]);

function isSuffix(token: string): boolean {
  return NAME_SUFFIXES.has(token.toLowerCase());
}

/** `F. Lastname` (suffix kept on last name when present). */
export function formatShortName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return fullName;

  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return parts[0]!;

  let suffix: string | null = null;
  const core = [...parts];
  const last = core[core.length - 1]!;
  if (core.length >= 3 && isSuffix(last)) {
    suffix = core.pop()!;
  }

  if (core.length === 0) return trimmed;

  const first = core[0]!;
  const lastName = core[core.length - 1]!;
  const initial = Array.from(first)[0] ?? first.charAt(0);
  const base = `${initial}. ${lastName}`;
  return suffix ? `${base} ${suffix}` : base;
}

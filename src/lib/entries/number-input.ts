/**
 * What a scout typed into a number box, as a tagged result so callers never have
 * to guess whether "" or NaN or 0 means "nothing entered".
 *
 *   ""  / "   "  -> empty   (no answer)
 *   "0" / "0.0"  -> ok, 0   (a real answer; zero is NOT empty)
 *   "7,5"        -> ok, 7.5 (phone keyboards in many locales only offer a comma)
 *   "abc" "1e999" "Infinity" "0x10" "1,2,3" "--1" -> invalid
 */
export type NumberInput =
  { kind: "empty" } | { kind: "ok"; value: number } | { kind: "invalid" };

/** Beyond this a typo (an extra few digits) is more likely than a real measurement. */
export const MAX_ABS_NUMBER = 1e9;

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parseNumberInput(raw: string): NumberInput {
  const text = raw.trim();
  if (text === "") return { kind: "empty" };

  // A single comma and no dot is a decimal comma ("7,5"). Anything with several
  // separators is ambiguous ("1,234.5"), so it is rejected instead of guessed.
  const normalized = /^[^.,]*,[^.,]*$/.test(text)
    ? text.replace(",", ".")
    : text;
  if (!PLAIN_NUMBER.test(normalized)) return { kind: "invalid" };

  const value = Number(normalized);
  if (!Number.isFinite(value) || Math.abs(value) >= MAX_ABS_NUMBER)
    return { kind: "invalid" };
  // Normalise -0 so it never reaches JSON/the database as a surprising "-0".
  return { kind: "ok", value: value === 0 ? 0 : value };
}

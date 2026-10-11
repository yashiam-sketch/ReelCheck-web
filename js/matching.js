// Title normalization and fuzzy comparison (same rules as the iOS app's TitleMatching).

const ARTICLES = new Set(["the", "a", "an"]);
const ROMAN_NUMERALS = new Map(Object.entries({ ii: "2", iii: "3", iv: "4", v: "5", vi: "6", vii: "7", viii: "8", ix: "9", x: "10" }));

/**
 * Lowercases, strips accents and punctuation, maps "&" to "and", drops a leading article and
 * collapses whitespace: "The Lord of the Rings: The Return of the King" →
 * "lord of the rings the return of the king".
 */
export function normalize(title, { keepLeadingArticle = false } = {}) {
  const words = String(title ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (!keepLeadingArticle && words.length > 1 && ARTICLES.has(words[0])) {
    words.shift();
  }
  return words.join(" ");
}

/** Edit distance between two strings (by code point). */
export function levenshtein(a, b) {
  const s = Array.from(a);
  const t = Array.from(b);
  if (s.length === 0) return t.length;
  if (t.length === 0) return s.length;
  let previous = Array.from({ length: t.length + 1 }, (_, j) => j);
  let current = new Array(t.length + 1).fill(0);
  for (let i = 1; i <= s.length; i++) {
    current[0] = i;
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
    }
    [previous, current] = [current, previous];
  }
  return previous[t.length];
}

/**
 * Similarity of two titles in 0...1 after normalization: the larger of the normalized
 * Levenshtein ratio and the word-set Jaccard index.
 */
export function similarity(lhs, rhs) {
  const a = normalize(lhs);
  const b = normalize(rhs);
  if (!a || !b) return 0;
  if (a === b) return 1;
  const editRatio = 1 - levenshtein(a, b) / Math.max(Array.from(a).length, Array.from(b).length);
  const wordsA = new Set(a.split(" "));
  const wordsB = new Set(b.split(" "));
  const shared = [...wordsA].filter((w) => wordsB.has(w)).length;
  const jaccard = shared / new Set([...wordsA, ...wordsB]).size;
  return Math.max(editRatio, jaccard);
}

/** Sequel markers as digits: numbers ("3", "2049") and a trailing roman numeral ("iii" → "3"). */
function numberTokens(normalized) {
  const words = normalized.split(" ").filter(Boolean);
  const tokens = new Set(words.filter((w) => /^\p{N}+$/u.test(w)).map((w) => (/^[0-9]+$/.test(w) ? String(Number(w)) : w)));
  const last = words[words.length - 1];
  if (ROMAN_NUMERALS.has(last)) tokens.add(ROMAN_NUMERALS.get(last));
  return tokens;
}

/**
 * Fuzzy equality that never equates different installments: "Toy Story 3" vs "Toy Story 4", or
 * "Moana 2" vs "Moana". "Frozen 2" and "Frozen II" are the same.
 */
export function isSameTitle(lhs, rhs, threshold = 0.85) {
  const a = numberTokens(normalize(lhs));
  const b = numberTokens(normalize(rhs));
  if (a.size !== b.size || [...a].some((t) => !b.has(t))) return false;
  return similarity(lhs, rhs) >= threshold;
}

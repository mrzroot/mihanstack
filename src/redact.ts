/** Secret scrubbing used by the recorder and the request log. */

export const REDACTED = "***REDACTED***";

const DEFAULT_KEYS = [
  "merchant_id",
  "merchant",
  "merchantid",
  "api_key",
  "apikey",
  "api-key",
  "x-api-key",
  "authorization",
  "cookie",
  "set-cookie",
  "token",
  "access_token",
  "secret",
  "password",
  "card_pan",
  "card_hash",
  "cardnumber",
];

export interface RedactRules {
  keys?: string[];
  pathPatterns?: RegExp[];
}

function keySet(extra: string[] = []): Set<string> {
  return new Set([...DEFAULT_KEYS, ...extra].map((k) => k.toLowerCase()));
}

/** Deep-copy `value`, replacing sensitive keys. Iranian mobile numbers are masked. */
export function redactValue(value: unknown, rules: RedactRules = {}, keys = keySet(rules.keys)): unknown {
  if (Array.isArray(value)) return value.map((v) => redactValue(v, rules, keys));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = keys.has(k.toLowerCase()) ? (v == null || v === "" ? v : REDACTED) : redactValue(v, rules, keys);
    }
    return out;
  }
  if (typeof value === "string") return maskMobiles(value);
  return value;
}

/** 09123456789 → 0912***6789 (keeps fixtures readable but not personal). */
export function maskMobiles(s: string): string {
  return s.replace(/(?<!\d)((?:\+98|0098|98|0)?9\d{2})\d{3}(\d{4})(?!\d)/g, "$1***$2");
}

export function redactPath(path: string, rules: RedactRules = {}): string {
  let out = path;
  for (const re of rules.pathPatterns ?? []) out = out.replace(re, (_m, a: string, _secret: string, c: string) => `${a}${REDACTED}${c}`);
  return out;
}

export function redactHeaders(h: Record<string, unknown>, rules: RedactRules = {}): Record<string, unknown> {
  const keys = keySet(rules.keys);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h)) out[k] = keys.has(k.toLowerCase()) ? REDACTED : v;
  return out;
}

export function redactQuery(q: Record<string, string>, rules: RedactRules = {}): Record<string, string> {
  return redactValue(q, rules) as Record<string, string>;
}

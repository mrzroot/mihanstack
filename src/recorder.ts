import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { redactHeaders, redactPath, redactValue, type RedactRules } from "./redact.js";

export interface Fixture {
  provider: string;
  method: string;
  path: string;
  query: Record<string, string>;
  body: unknown;
  response: { status: number; headers: Record<string, string>; body: unknown };
  recordedAt: string;
}

const KEEP_RESPONSE_HEADERS = ["content-type", "location"];

export function toFixture(
  provider: string,
  rules: RedactRules,
  req: { method: string; path: string; query: Record<string, string>; body: unknown },
  res: { status: number; headers: Headers | Record<string, string>; body: unknown },
): Fixture {
  const headers: Record<string, string> = {};
  const get = (k: string) => (res.headers instanceof Headers ? res.headers.get(k) : (res.headers as Record<string, string>)[k]);
  for (const k of KEEP_RESPONSE_HEADERS) {
    const v = get(k);
    if (v) headers[k] = v;
  }
  return {
    provider,
    method: req.method.toUpperCase(),
    path: redactPath(req.path, rules),
    query: redactValue(req.query, rules) as Record<string, string>,
    body: redactValue(req.body, rules),
    response: { status: res.status, headers: redactHeaders(headers, rules) as Record<string, string>, body: redactValue(res.body, rules) },
    recordedAt: new Date().toISOString(),
  };
}

export class FixtureWriter {
  private n = 0;
  constructor(private dir: string) {
    mkdirSync(dir, { recursive: true });
    this.n = countJson(dir);
  }
  write(f: Fixture): string {
    const dir = join(this.dir, f.provider);
    mkdirSync(dir, { recursive: true });
    const slug = f.path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "root";
    const file = join(dir, `${String(++this.n).padStart(4, "0")}-${f.method.toLowerCase()}-${slug}.json`);
    writeFileSync(file, JSON.stringify(f, null, 2) + "\n");
    return file;
  }
}

function countJson(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) n += countJson(p);
    else if (e.endsWith(".json")) n++;
  }
  return n;
}

export function loadFixtures(dir: string): Fixture[] {
  const out: Fixture[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d).sort()) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (e.endsWith(".json")) {
        const f = JSON.parse(readFileSync(p, "utf8")) as Fixture;
        if (f && f.provider && f.method && f.path && f.response) out.push(f);
      }
    }
  };
  walk(dir);
  return out;
}

const stable = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort()) : x));

/** Matches incoming (already-redacted) requests to fixtures: exact body/query first, then in recorded order. */
export class FixtureIndex {
  private cursors = new Map<string, number>();
  constructor(public fixtures: Fixture[]) {}

  find(provider: string, method: string, path: string, query: unknown, body: unknown): Fixture | undefined {
    const candidates = this.fixtures.filter(
      (f) => f.provider === provider && f.method === method.toUpperCase() && f.path.toLowerCase() === path.toLowerCase(),
    );
    if (!candidates.length) return undefined;
    const sig = stable(body) + "|" + stable(query);
    const exact = candidates.filter((f) => stable(f.body) + "|" + stable(f.query) === sig);
    const pool = exact.length ? exact : candidates;
    const key = `${provider} ${method} ${path} ${exact.length ? sig : "*"}`;
    const i = this.cursors.get(key) ?? 0;
    this.cursors.set(key, i + 1);
    return pool[i % pool.length];
  }
}

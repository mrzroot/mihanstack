import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import YAML from "yaml";
import type { ServiceSettings } from "./types.js";

export interface ChaosSettings {
  enabled: boolean;
  /** "all", "payment", "sms", "network" or a provider name. */
  category: string;
  /** Probability (0..1) that a matching request fails. */
  rate: number;
  /** Optional fixed seed for reproducible chaos. */
  seed?: number;
}

export interface MihanConfig {
  port: number;
  host: string;
  /** Public URL used in redirects/StartPay links (defaults to http://localhost:<port>). */
  publicUrl?: string;
  plugins: string[];
  services: Record<string, Partial<ServiceSettings>>;
  chaos: ChaosSettings;
  /** Directory of recorded fixtures to replay (offline mode). */
  replay?: string;
  /** In replay mode, return 404 for unmatched requests instead of falling back to emulation. */
  replayStrict?: boolean;
  logSize: number;
  /** Base directory for resolving relative plugin/fixture paths. */
  baseDir: string;
}

export const DEFAULT_PORT = 8585;

export function defaultConfig(): MihanConfig {
  return {
    port: DEFAULT_PORT,
    host: "127.0.0.1",
    plugins: [],
    services: {},
    chaos: { enabled: false, category: "all", rate: 0.3 },
    logSize: 500,
    baseDir: process.cwd(),
  };
}

export const DEFAULT_SETTINGS: ServiceSettings = {
  scenario: "success",
  latency: 0,
  slowMs: 3000,
  timeoutMs: 35_000,
  autoRedirect: false,
  enabled: true,
  options: {},
};

export class ConfigError extends Error {}

const CONFIG_NAMES = ["mihanstack.yml", "mihanstack.yaml", ".mihanstack.yml"];

export function findConfig(path?: string, cwd = process.cwd()): string | undefined {
  if (path) {
    const p = resolve(cwd, path);
    if (!existsSync(p)) throw new ConfigError(`config not found: ${p}`);
    return p;
  }
  return CONFIG_NAMES.map((n) => resolve(cwd, n)).find((p) => existsSync(p));
}

function expandEnv(v: unknown): unknown {
  if (typeof v === "string") return v.replace(/\$\{([A-Z_][A-Z0-9_]*)(?::-([^}]*))?\}/gi, (_, k, d) => process.env[k] ?? d ?? "");
  if (Array.isArray(v)) return v.map(expandEnv);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, expandEnv(x)]));
  return v;
}

export function parseConfig(raw: unknown, baseDir = process.cwd()): MihanConfig {
  const cfg = defaultConfig();
  cfg.baseDir = baseDir;
  if (raw == null) return cfg;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new ConfigError("config root must be a mapping");
  const r = expandEnv(raw) as Record<string, any>;
  if (r.port != null) {
    const port = Number(r.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new ConfigError(`invalid port: ${r.port}`);
    cfg.port = port;
  }
  if (r.host) cfg.host = String(r.host);
  if (r.publicUrl) cfg.publicUrl = String(r.publicUrl).replace(/\/$/, "");
  if (r.plugins) {
    if (!Array.isArray(r.plugins)) throw new ConfigError("plugins must be a list of module paths");
    cfg.plugins = r.plugins.map(String);
  }
  if (r.replay) cfg.replay = String(r.replay);
  if (r.replayStrict != null) cfg.replayStrict = Boolean(r.replayStrict);
  if (r.logSize) cfg.logSize = Number(r.logSize);
  if (r.chaos) {
    const c = r.chaos === true ? {} : r.chaos;
    cfg.chaos = { enabled: c.enabled ?? true, category: String(c.category ?? "all"), rate: Number(c.rate ?? 0.3), seed: c.seed };
    if (!(cfg.chaos.rate >= 0 && cfg.chaos.rate <= 1)) throw new ConfigError("chaos.rate must be between 0 and 1");
  }
  if (r.services) {
    if (typeof r.services !== "object") throw new ConfigError("services must be a mapping");
    for (const [name, s] of Object.entries<any>(r.services)) {
      if (s == null) {
        cfg.services[name] = {};
        continue;
      }
      if (typeof s === "string") {
        cfg.services[name] = { scenario: s };
        continue;
      }
      const out: Partial<ServiceSettings> = {};
      if (s.scenario) out.scenario = String(s.scenario);
      if (s.latency != null) out.latency = parseLatencySpec(s.latency);
      if (s.slowMs != null) out.slowMs = Number(s.slowMs);
      if (s.timeoutMs != null) out.timeoutMs = Number(s.timeoutMs);
      if (s.autoRedirect != null) out.autoRedirect = Boolean(s.autoRedirect);
      if (s.enabled != null) out.enabled = Boolean(s.enabled);
      if (s.options) out.options = s.options;
      cfg.services[name] = out;
    }
  }
  return cfg;
}

export function loadConfig(path?: string, cwd = process.cwd()): MihanConfig {
  const file = findConfig(path, cwd);
  if (!file) return parseConfig(null, cwd);
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(file, "utf8"));
  } catch (e) {
    throw new ConfigError(`invalid YAML in ${file}: ${(e as Error).message}`);
  }
  return parseConfig(raw, resolve(file, ".."));
}

/** Accept 250, "250", "250ms", "100-800". Throws on garbage. */
export function parseLatencySpec(v: unknown): number | string {
  if (typeof v === "number" && v >= 0) return v;
  const s = String(v).trim().replace(/ms$/i, "");
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d+\s*-\s*\d+$/.test(s)) return s.replace(/\s/g, "");
  throw new ConfigError(`invalid latency: ${JSON.stringify(v)} (use 250 or "100-800")`);
}

export function resolveLatency(spec: number | string, rand = Math.random): number {
  if (typeof spec === "number") return spec;
  const [a, b] = spec.split("-").map(Number);
  if (b === undefined) return a;
  return Math.round(Math.min(a, b) + rand() * Math.abs(b - a));
}

export const SAMPLE_CONFIG = `# mihanstack.yml · The local development cloud for Iranian services
port: 8585
host: 127.0.0.1

services:
  zarinpal:
    scenario: success          # success | failed | duplicate_callback | wrong_amount | invalid_signature
                               # merchant_disabled | timeout | network_error | server_error | latency
    latency: 0                 # ms, or a range like "100-800"
    autoRedirect: false        # true: StartPay redirects immediately (handy in CI)
  zibal:
    scenario: success
    options:
      merchants: [zibal]       # accepted merchant ids (empty = accept any)
  kavenegar:
    scenario: success
    options:
      apiKeys: []              # accepted API keys (empty = accept any)
      templates:
        verify: "کد تایید شما: %token%"
  smsir:
    scenario: success
    options:
      templates:
        "100000": "کد ورود شما #CODE# است"

# Random failure injection (also: \`mihanstack chaos payment --rate 0.3\`)
chaos:
  enabled: false
  category: all                # all | payment | sms | network | <service name>
  rate: 0.3

# plugins:
#   - ./my-provider.mjs        # default export = defineProvider({...})
# replay: ./fixtures           # serve recorded fixtures offline
`;

import { TRANSPORT_SCENARIOS, type Provider, type ProviderDefinition } from "./types.js";

const NAME_RE = /^[a-z][a-z0-9-]*$/;

/**
 * Define an emulated service. Built-in providers use exactly this API, so a
 * plugin is just a module whose default export is `defineProvider({...})`.
 */
export function defineProvider(def: ProviderDefinition): Provider {
  if (!def || typeof def !== "object") throw new TypeError("defineProvider: definition object required");
  if (!NAME_RE.test(def.name ?? "")) {
    throw new TypeError(`defineProvider: name must match ${NAME_RE} (got ${JSON.stringify(def.name)})`);
  }
  if (!Array.isArray(def.endpoints) || def.endpoints.length === 0) {
    throw new TypeError(`defineProvider(${def.name}): at least one endpoint is required`);
  }
  for (const e of def.endpoints) {
    if (!e.path?.startsWith("/")) throw new TypeError(`defineProvider(${def.name}): endpoint path must start with "/"`);
    if (typeof e.handler !== "function") throw new TypeError(`defineProvider(${def.name}): endpoint ${e.path} needs a handler`);
  }
  const scenarios = def.scenarios?.length ? [...new Set(def.scenarios)] : ["success"];
  const defaultScenario = def.defaultScenario ?? (scenarios.includes("success") ? "success" : scenarios[0]);
  return {
    name: def.name,
    displayName: def.displayName ?? def.name,
    description: def.description ?? "",
    category: def.category ?? "other",
    hosts: def.hosts ?? [],
    endpoints: def.endpoints,
    scenarios,
    defaultScenario,
    defaultOptions: def.defaultOptions ?? {},
    webhook: def.webhook,
    redact: def.redact,
    allScenarios: [...scenarios, ...TRANSPORT_SCENARIOS.filter((s) => !scenarios.includes(s))],
  };
}

/** Match `/v1/:key/sms/send.json` against a concrete path. Returns params or null. */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const a = path.split("/").filter(Boolean);
  if (p.length !== a.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) params[p[i].slice(1)] = decodeURIComponent(a[i]);
    else if (p[i].toLowerCase() !== a[i].toLowerCase()) return null;
  }
  return params;
}

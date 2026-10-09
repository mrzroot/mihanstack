import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_SETTINGS, defaultConfig, resolveLatency, type ChaosSettings, type MihanConfig } from "./config.js";
import { defineProvider, matchPath } from "./provider.js";
import { builtinProviders } from "./providers/index.js";
import { FixtureIndex, FixtureWriter, loadFixtures, toFixture } from "./recorder.js";
import { redactHeaders, redactPath, redactValue } from "./redact.js";
import { TRANSPORT_SCENARIOS, type Endpoint, type HandlerContext, type LogEntry, type MihanRequest, type MihanResponse, type Provider, type ServiceSettings, type SmsMessage } from "./types.js";
import { dashboardHtml } from "./ui/dashboard.js";
import { buildWebhook, sendWebhook, type WebhookInput } from "./webhook.js";
import { VERSION } from "./version.js";

export interface StartOptions {
  config?: Partial<MihanConfig>;
  /** Extra providers (already defined) in addition to built-ins and config plugins. */
  providers?: Provider[];
  /** Record mode: forward to these upstreams (provider → base URL) and save fixtures. */
  record?: { upstreams: Record<string, string>; dir: string };
  quiet?: boolean;
}

export interface RunningStack {
  stack: MihanStack;
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

const MAX_BODY = 5 * 1024 * 1024;
const FAILURE_EXCLUDE = new Set(["success"]);
const NETWORK_POOL = ["timeout", "network_error", "server_error", "latency"];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function last10(n: string): string {
  const d = n.replace(/\D/g, "");
  return d.slice(-10);
}

export class MihanStack {
  readonly providers = new Map<string, Provider>();
  readonly settings = new Map<string, ServiceSettings>();
  readonly state = new Map<string, Map<string, any>>();
  readonly logs: LogEntry[] = [];
  readonly inbox: SmsMessage[] = [];
  chaos: ChaosSettings;
  replay?: FixtureIndex;
  record?: { upstreams: Record<string, string>; writer: FixtureWriter; dir: string };
  private seq = 0;
  private smsSeq = 0;
  private rand: () => number;
  publicUrl?: string;

  constructor(public config: MihanConfig, providers: Provider[]) {
    for (const p of providers) this.addProvider(p);
    this.chaos = { ...config.chaos };
    this.rand = config.chaos.seed != null ? mulberry32(config.chaos.seed) : Math.random;
    this.publicUrl = config.publicUrl;
  }

  addProvider(p: Provider): void {
    if (this.providers.has(p.name)) throw new Error(`duplicate provider name: ${p.name}`);
    this.providers.set(p.name, p);
    const user = this.config.services[p.name] ?? {};
    const s: ServiceSettings = {
      ...DEFAULT_SETTINGS,
      scenario: p.defaultScenario,
      ...user,
      options: { ...p.defaultOptions, ...(user.options ?? {}) },
    };
    this.assertScenario(p, s.scenario);
    this.settings.set(p.name, s);
    this.state.set(p.name, new Map());
  }

  assertScenario(p: Provider, scenario: string): void {
    if (!p.allScenarios.includes(scenario)) {
      throw new Error(`unknown scenario "${scenario}" for ${p.name} (available: ${p.allScenarios.join(", ")})`);
    }
  }

  updateService(name: string, patch: Partial<ServiceSettings>): ServiceSettings {
    const p = this.providers.get(name);
    if (!p) throw new Error(`unknown service: ${name}`);
    const cur = this.settings.get(name)!;
    if (patch.scenario) this.assertScenario(p, patch.scenario);
    const next: ServiceSettings = { ...cur, ...patch, options: { ...cur.options, ...(patch.options ?? {}) } };
    this.settings.set(name, next);
    return next;
  }

  reset(): void {
    for (const m of this.state.values()) m.clear();
    this.logs.length = 0;
    this.inbox.length = 0;
  }

  setChaos(c: Partial<ChaosSettings>): ChaosSettings {
    const next = { ...this.chaos, ...c };
    if (!(next.rate >= 0 && next.rate <= 1)) throw new Error("rate must be between 0 and 1");
    const valid = ["all", "payment", "sms", "network", ...this.providers.keys(), ...new Set([...this.providers.values()].map((p) => p.category))];
    if (!valid.includes(next.category)) throw new Error(`unknown chaos category "${next.category}" (use: ${[...new Set(valid)].join(", ")})`);
    if (c.seed != null) this.rand = mulberry32(c.seed);
    this.chaos = next;
    return next;
  }

  /** Decide whether chaos hits this request; returns the injected scenario or null. */
  chaosPick(p: Provider): string | null {
    const c = this.chaos;
    if (!c.enabled || c.rate <= 0) return null;
    const applies = c.category === "all" || c.category === "network" || c.category === p.category || c.category === p.name;
    if (!applies) return null;
    if (this.rand() >= c.rate) return null;
    const pool = c.category === "network" ? NETWORK_POOL : p.allScenarios.filter((s) => !FAILURE_EXCLUDE.has(s));
    return pool[Math.floor(this.rand() * pool.length)] ?? null;
  }

  pushSms(provider: string, m: Omit<SmsMessage, "id" | "at" | "provider">): SmsMessage {
    const msg: SmsMessage = { id: ++this.smsSeq, provider, at: new Date().toISOString(), ...m };
    this.inbox.push(msg);
    if (this.inbox.length > 1000) this.inbox.shift();
    return msg;
  }

  findSms(receptor?: string): SmsMessage[] {
    if (!receptor) return [...this.inbox];
    const k = last10(receptor);
    return this.inbox.filter((m) => last10(m.receptor) === k);
  }

  log(e: Omit<LogEntry, "id" | "at">): LogEntry {
    const entry: LogEntry = { id: ++this.seq, at: new Date().toISOString(), ...e };
    this.logs.push(entry);
    while (this.logs.length > this.config.logSize) this.logs.shift();
    return entry;
  }

  /** Resolve which provider a request is for. Returns provider + path relative to it. */
  route(path: string, host?: string): { provider: Provider; path: string; prefixed: boolean } | null {
    const seg = path.split("/")[1]?.toLowerCase();
    if (seg && this.providers.has(seg)) {
      return { provider: this.providers.get(seg)!, path: path.slice(seg.length + 1) || "/", prefixed: true };
    }
    const hostname = host?.split(":")[0]?.toLowerCase();
    if (hostname) {
      for (const p of this.providers.values()) if (p.hosts.includes(hostname)) return { provider: p, path, prefixed: false };
    }
    const hits = [...this.providers.values()].filter((p) => p.endpoints.some((e) => matchPath(e.path, path)));
    if (hits.length === 1) return { provider: hits[0], path, prefixed: false };
    return null;
  }
}

/* ------------------------------------------------------------------ helpers */

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > MAX_BODY) throw Object.assign(new Error("payload too large"), { status: 413 });
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(raw: string, contentType = ""): Record<string, any> {
  if (!raw) return {};
  if (contentType.includes("application/x-www-form-urlencoded")) return Object.fromEntries(new URLSearchParams(raw));
  try {
    const v = JSON.parse(raw);
    return v && typeof v === "object" ? v : { _: v };
  } catch {
    if (raw.includes("=")) return Object.fromEntries(new URLSearchParams(raw));
    return { _raw: raw };
  }
}

function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  if (res.headersSent || res.destroyed) return;
  const isString = typeof body === "string";
  const payload = body === undefined ? "" : isString ? body : JSON.stringify(body);
  res.writeHead(status, {
    "content-type": isString ? "text/plain; charset=utf-8" : "application/json; charset=utf-8",
    "x-powered-by": `MihanStack/${VERSION}`,
    ...headers,
  });
  res.end(payload);
}

function json(res: ServerResponse, status: number, body: unknown): void {
  send(res, status, body, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
}

function randomId(digits = 9): string {
  let s = String(1 + Math.floor(Math.random() * 9));
  while (s.length < digits) s += Math.floor(Math.random() * 10);
  return s;
}

function findEndpoint(p: Provider, method: string, path: string): { ep: Endpoint; params: Record<string, string> } | { allowed: string[] } | null {
  const allowed: string[] = [];
  for (const ep of p.endpoints) {
    const params = matchPath(ep.path, path);
    if (!params) continue;
    if (ep.method === "ANY" || ep.method === method) return { ep, params };
    allowed.push(ep.method);
  }
  return allowed.length ? { allowed } : null;
}

/* ------------------------------------------------------------------ server */

export async function loadPlugins(paths: string[], baseDir: string): Promise<Provider[]> {
  const out: Provider[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : resolve(baseDir, p);
    const mod = await import(pathToFileURL(abs).href);
    const exported = mod.default ?? mod.provider;
    const list = Array.isArray(exported) ? exported : [exported];
    for (const prov of list) {
      if (!prov || !prov.name || !prov.endpoints) {
        throw new Error(`plugin ${p} must default-export defineProvider({...}) (or an array of them)`);
      }
      // Plain definition objects are accepted too, so plugins need no dependency on mihanstack.
      out.push(prov.allScenarios ? prov : defineProvider(prov));
    }
  }
  return out;
}

export async function startServer(opts: StartOptions = {}): Promise<RunningStack> {
  const config: MihanConfig = { ...defaultConfig(), ...(opts.config ?? {}) } as MihanConfig;
  config.chaos = { ...defaultConfig().chaos, ...(opts.config?.chaos ?? {}) };
  const plugins = await loadPlugins(config.plugins ?? [], config.baseDir);
  const stack = new MihanStack(config, [...builtinProviders, ...plugins, ...(opts.providers ?? [])]);
  if (config.replay) {
    const dir = isAbsolute(config.replay) ? config.replay : resolve(config.baseDir, config.replay);
    stack.replay = new FixtureIndex(loadFixtures(dir));
  }
  if (opts.record) {
    for (const name of Object.keys(opts.record.upstreams)) {
      if (!stack.providers.has(name)) throw new Error(`record: unknown provider ${name}`);
    }
    stack.record = { upstreams: opts.record.upstreams, writer: new FixtureWriter(opts.record.dir), dir: opts.record.dir };
  }

  const server = createHttpServer((req, res) => {
    handle(stack, req, res).catch((e) => {
      const status = (e as { status?: number }).status ?? 500;
      json(res, status, { error: (e as Error).message });
    });
  });
  server.keepAliveTimeout = 5000;

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(config.port, config.host, () => resolveListen());
  });
  const port = (server.address() as AddressInfo).port;
  const host = config.host === "0.0.0.0" || config.host === "::" ? "localhost" : config.host;
  const url = `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
  const sockets = new Set<import("node:net").Socket>();
  server.on("connection", (s) => {
    sockets.add(s);
    s.on("close", () => sockets.delete(s));
  });
  return {
    stack,
    server,
    url,
    port,
    close: () =>
      new Promise<void>((r) => {
        for (const s of sockets) s.destroy();
        server.close(() => r());
      }),
  };
}

async function handle(stack: MihanStack, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://local");
  const path = url.pathname;
  const method = (req.method ?? "GET").toUpperCase();

  if (method === "OPTIONS") {
    res.writeHead(204, { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" });
    res.end();
    return;
  }
  if (path === "/" || path === "/_mihan" || path === "/_mihan/" || path === "/_mihan/ui") {
    send(res, 200, dashboardHtml(), { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    return;
  }
  if (path.startsWith("/_mihan/")) return admin(stack, req, res, url, method);

  const routed = stack.route(path, req.headers.host);
  if (!routed) {
    json(res, 404, { error: "no emulated service matches this path", hint: `prefix the path with a service name: ${[...stack.providers.keys()].map((n) => "/" + n).join(", ")}` });
    return;
  }
  const { provider: p, prefixed } = routed;
  const ppath = routed.path;
  const settings = stack.settings.get(p.name)!;
  const t0 = performance.now();
  const raw = await readBody(req);
  const body = parseBody(raw, String(req.headers["content-type"] ?? ""));
  const query = Object.fromEntries(url.searchParams);
  const rules = p.redact ?? {};
  const logReq = { query: redactValue(query, rules), headers: redactHeaders({ "content-type": req.headers["content-type"], "x-api-key": req.headers["x-api-key"], authorization: req.headers.authorization }, rules), body: redactValue(body, rules) };
  const logPath = redactPath(ppath, rules);

  if (!settings.enabled) {
    json(res, 503, { error: `${p.name} is disabled in MihanStack` });
    stack.log({ service: p.name, method, path: logPath, status: 503, durationMs: 0, scenario: "disabled", chaos: false, request: logReq, response: null });
    return;
  }

  // Scenario: explicit header/query override > chaos > configured
  const override = String(req.headers["x-mihan-scenario"] ?? query.mihan_scenario ?? "");
  let scenario = settings.scenario;
  let chaos = false;
  if (override) {
    if (!p.allScenarios.includes(override)) {
      json(res, 400, { error: `unknown scenario "${override}" for ${p.name}`, available: p.allScenarios });
      return;
    }
    scenario = override;
  } else {
    const picked = stack.chaosPick(p);
    if (picked) {
      scenario = picked;
      chaos = true;
    }
  }

  const finish = (status: number | null, response: unknown, extra: Partial<LogEntry> = {}) =>
    stack.log({ service: p.name, method, path: logPath, status, durationMs: Math.round(performance.now() - t0), scenario, chaos, request: logReq, response, ...extra });

  // Record mode: proxy to the real upstream and save a redacted fixture.
  if (stack.record?.upstreams[p.name]) {
    const upstream = stack.record.upstreams[p.name].replace(/\/$/, "");
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (["host", "connection", "content-length", "accept-encoding", "x-mihan-scenario"].includes(k) || v == null) continue;
      headers[k] = Array.isArray(v) ? v.join(", ") : v;
    }
    const target = upstream + ppath + url.search;
    const up = await fetch(target, { method, headers, body: raw && method !== "GET" && method !== "HEAD" ? raw : undefined, redirect: "manual" });
    const text = await up.text();
    let parsed: unknown = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      /* keep text */
    }
    const fx = toFixture(p.name, rules, { method, path: ppath, query, body }, { status: up.status, headers: up.headers, body: parsed });
    stack.record.writer.write(fx);
    const outHeaders: Record<string, string> = {};
    for (const k of ["content-type", "location"]) {
      const v = up.headers.get(k);
      if (v) outHeaders[k] = v;
    }
    send(res, up.status, text, outHeaders);
    finish(up.status, fx.response.body, { scenario: "record" });
    return;
  }

  // Replay mode: serve recorded fixtures offline.
  if (stack.replay) {
    const fx = stack.replay.find(p.name, method, logPath, redactValue(query, rules), redactValue(body, rules));
    if (fx) {
      const b = fx.response.body;
      send(res, fx.response.status, typeof b === "string" ? b : JSON.stringify(b), {
        "content-type": "application/json; charset=utf-8",
        ...fx.response.headers,
        "x-mihan-replay": "1",
      });
      finish(fx.response.status, b, { scenario: "replay", replayed: true });
      return;
    }
    if (stack.config.replayStrict) {
      json(res, 404, { error: "no recorded fixture matches this request" });
      finish(404, null, { scenario: "replay-miss" });
      return;
    }
  }

  // Latency (always) + extra for the latency scenario
  let delay = resolveLatency(settings.latency);
  if (scenario === "latency") delay += settings.slowMs;
  if (delay > 0) await sleep(delay);

  if (scenario === "timeout") {
    finish(null, "[timeout: connection held, then dropped]");
    await sleep(settings.timeoutMs);
    req.socket.destroy();
    return;
  }
  if (scenario === "network_error") {
    finish(null, "[network_error: socket reset]");
    req.socket.destroy();
    return;
  }
  if (scenario === "server_error") {
    send(res, 500, "<html><body><h1>500 Internal Server Error</h1></body></html>", { "content-type": "text/html; charset=utf-8" });
    finish(500, "[500 Internal Server Error]");
    return;
  }

  const found = findEndpoint(p, method, ppath);
  if (!found) {
    json(res, 404, { error: `${p.name}: no endpoint ${method} ${ppath}`, endpoints: p.endpoints.map((e) => `${e.method} ${e.path}`) });
    finish(404, null);
    return;
  }
  if ("allowed" in found) {
    json(res, 405, { error: `${p.name}: method ${method} not allowed`, allowed: found.allowed });
    finish(405, null);
    return;
  }

  const origin = stack.publicUrl ?? `http://${req.headers.host ?? "localhost"}`;
  const mreq: MihanRequest = { method, path: ppath, query, headers: req.headers, body, rawBody: raw, params: found.params };
  const ctx: HandlerContext = {
    req: mreq,
    scenario: TRANSPORT_SCENARIOS.includes(scenario as any) ? "success" : scenario,
    settings,
    state: stack.state.get(p.name)!,
    baseUrl: prefixed ? `${origin}/${p.name}` : origin,
    sms: (m) => stack.pushSms(p.name, m),
    fireCallback: (target, init) => {
      setTimeout(() => {
        const t = performance.now();
        fetch(target, { method: init?.method ?? "GET", body: init?.body, headers: init?.headers, redirect: "manual" })
          .then((r) => stack.log({ service: "callback", method: init?.method ?? "GET", path: target, status: r.status, durationMs: Math.round(performance.now() - t), scenario: `${p.name}:duplicate_callback`, chaos: false, request: null, response: null }))
          .catch((e) => stack.log({ service: "callback", method: init?.method ?? "GET", path: target, status: null, durationMs: Math.round(performance.now() - t), scenario: `${p.name}:duplicate_callback`, chaos: false, request: null, response: String(e?.cause?.code ?? e) }));
      }, 150);
    },
    randomId,
  };
  const out: MihanResponse = await found.ep.handler(ctx);
  if (out.redirect) {
    res.writeHead(302, { location: out.redirect, "x-powered-by": `MihanStack/${VERSION}` });
    res.end();
    finish(302, { redirect: redactValue(out.redirect, rules) });
    return;
  }
  if (out.html != null) {
    send(res, out.status ?? 200, out.html, { "content-type": "text/html; charset=utf-8", ...(out.headers ?? {}) });
    finish(out.status ?? 200, "[html]");
    return;
  }
  send(res, out.status ?? 200, out.body ?? {}, { "content-type": "application/json; charset=utf-8", ...(out.headers ?? {}) });
  finish(out.status ?? 200, redactValue(out.body, rules));
}

/* ------------------------------------------------------------------ admin API */

async function admin(stack: MihanStack, req: IncomingMessage, res: ServerResponse, url: URL, method: string): Promise<void> {
  const parts = url.pathname.split("/").filter(Boolean).slice(1); // after _mihan
  const body = ["POST", "PUT", "PATCH"].includes(method) ? parseBody(await readBody(req), "application/json") : {};
  const route = `${method} /${parts.join("/")}`;
  try {
    if (route === "GET /health") return json(res, 200, { ok: true, version: VERSION, services: [...stack.providers.keys()] });
    if (route === "GET /services") {
      return json(res, 200, [...stack.providers.values()].map((p) => ({
        name: p.name,
        displayName: p.displayName,
        category: p.category,
        description: p.description,
        hosts: p.hosts,
        scenarios: p.allScenarios,
        endpoints: p.endpoints.map((e) => ({ method: e.method, path: e.path, description: e.description })),
        settings: stack.settings.get(p.name),
        webhook: Boolean(p.webhook),
      })));
    }
    if (parts[0] === "services" && parts[1] && (method === "PUT" || method === "PATCH" || method === "POST")) {
      const patch: Partial<ServiceSettings> = {};
      if (body.scenario != null) patch.scenario = String(body.scenario);
      if (body.latency != null) patch.latency = typeof body.latency === "number" ? body.latency : String(body.latency);
      for (const k of ["slowMs", "timeoutMs"] as const) if (body[k] != null) patch[k] = Number(body[k]);
      for (const k of ["autoRedirect", "enabled"] as const) if (body[k] != null) patch[k] = Boolean(body[k]);
      if (body.options) patch.options = body.options;
      return json(res, 200, stack.updateService(parts[1], patch));
    }
    if (route === "GET /logs") {
      const since = Number(url.searchParams.get("since") ?? 0);
      const svc = url.searchParams.get("service");
      return json(res, 200, stack.logs.filter((l) => l.id > since && (!svc || l.service === svc)));
    }
    if (route === "DELETE /logs") {
      stack.logs.length = 0;
      return json(res, 200, { ok: true });
    }
    if (route === "GET /sms") {
      const list = stack.findSms(url.searchParams.get("receptor") ?? undefined);
      return json(res, 200, url.searchParams.get("last") ? list.slice(-1) : list);
    }
    if (route === "DELETE /sms") {
      stack.inbox.length = 0;
      return json(res, 200, { ok: true });
    }
    if (route === "GET /transactions") {
      const out: Record<string, unknown[]> = {};
      for (const [name, st] of stack.state) {
        const tx = st.get("tx");
        if (tx instanceof Map) out[name] = [...tx.values()];
      }
      return json(res, 200, redactValue(out));
    }
    if (route === "GET /chaos") return json(res, 200, stack.chaos);
    if (route === "POST /chaos" || route === "PUT /chaos") {
      return json(res, 200, stack.setChaos({ enabled: body.enabled ?? true, ...(body.category ? { category: String(body.category) } : {}), ...(body.rate != null ? { rate: Number(body.rate) } : {}), ...(body.seed != null ? { seed: Number(body.seed) } : {}) }));
    }
    if (route === "DELETE /chaos") return json(res, 200, stack.setChaos({ enabled: false }));
    if (route === "POST /webhook") {
      const input = body as WebhookInput;
      const wreq = buildWebhook(stack.providers, input);
      const attempts = await sendWebhook(wreq, input);
      for (const a of attempts) {
        stack.log({ service: "webhook", method: wreq.method, path: wreq.url, status: a.status, durationMs: a.ms, scenario: input.provider ?? "custom", chaos: false, request: wreq.body ?? null, response: a.error ?? a.body?.slice(0, 300) ?? null });
      }
      return json(res, 200, { request: wreq, attempts });
    }
    if (route === "POST /reset") {
      stack.reset();
      return json(res, 200, { ok: true });
    }
    return json(res, 404, { error: `unknown admin route ${route}` });
  } catch (e) {
    return json(res, 400, { error: (e as Error).message });
  }
}

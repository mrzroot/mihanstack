#!/usr/bin/env node
import { existsSync, writeFileSync } from "node:fs";
import { Command, InvalidArgumentError } from "commander";
import { ConfigError, DEFAULT_PORT, loadConfig, parseLatencySpec, SAMPLE_CONFIG, type MihanConfig } from "./config.js";
import { builtinProviders } from "./providers/index.js";
import { loadPlugins, startServer, type StartOptions } from "./server.js";
import { buildWebhook, sendWebhook } from "./webhook.js";
import { VERSION } from "./version.js";

const c = {
  g: (s: string) => (process.stdout.isTTY ? `\x1b[32m${s}\x1b[0m` : s),
  r: (s: string) => (process.stdout.isTTY ? `\x1b[31m${s}\x1b[0m` : s),
  y: (s: string) => (process.stdout.isTTY ? `\x1b[33m${s}\x1b[0m` : s),
  d: (s: string) => (process.stdout.isTTY ? `\x1b[2m${s}\x1b[0m` : s),
  b: (s: string) => (process.stdout.isTTY ? `\x1b[1m${s}\x1b[0m` : s),
};

const collect = (v: string, prev: string[] = []) => [...prev, v];
const kv = (list: string[] = [], what: string): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const item of list) {
    const i = item.indexOf("=");
    if (i < 1) throw new InvalidArgumentError(`${what} must look like name=value (got "${item}")`);
    out[item.slice(0, i)] = item.slice(i + 1);
  }
  return out;
};
const int = (v: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 0) throw new InvalidArgumentError("must be a non-negative integer");
  return n;
};
const rate = (v: string) => {
  const n = Number(v);
  if (!(n >= 0 && n <= 1)) throw new InvalidArgumentError("must be between 0 and 1");
  return n;
};

function die(msg: string): never {
  console.error(c.r(`✗ ${msg}`));
  process.exit(1);
}

interface ServeFlags {
  config?: string;
  port?: number;
  host?: string;
  publicUrl?: string;
  scenario?: string[];
  latency?: string[];
  autoRedirect?: boolean;
  chaos?: string;
  rate?: number;
  seed?: number;
  replay?: string;
  strict?: boolean;
}

function buildConfig(f: ServeFlags): MihanConfig {
  const cfg = loadConfig(f.config);
  if (f.port != null) cfg.port = f.port;
  else if (process.env.PORT) cfg.port = Number(process.env.PORT);
  if (f.host) cfg.host = f.host;
  if (f.publicUrl) cfg.publicUrl = f.publicUrl.replace(/\/$/, "");
  for (const [svc, sc] of Object.entries(kv(f.scenario, "--scenario"))) cfg.services[svc] = { ...cfg.services[svc], scenario: sc };
  for (const [svc, l] of Object.entries(kv(f.latency, "--latency"))) cfg.services[svc] = { ...cfg.services[svc], latency: parseLatencySpec(l) };
  if (f.autoRedirect) {
    for (const p of ["zarinpal", "zibal"]) cfg.services[p] = { ...cfg.services[p], autoRedirect: true };
  }
  if (f.chaos) cfg.chaos = { ...cfg.chaos, enabled: true, category: f.chaos, rate: f.rate ?? cfg.chaos.rate, seed: f.seed ?? cfg.chaos.seed };
  if (f.replay) cfg.replay = f.replay;
  if (f.strict) cfg.replayStrict = true;
  return cfg;
}

async function serve(f: ServeFlags, extra: Partial<StartOptions> = {}, mode = "") {
  let cfg: MihanConfig;
  try {
    cfg = buildConfig(f);
  } catch (e) {
    die((e as Error).message);
  }
  try {
    const run = await startServer({ config: cfg, ...extra });
    const { stack, url } = run;
    console.log(`\n  ${c.b("MihanStack")} ${c.d("v" + VERSION)}  ${c.d("· The local development cloud for Iranian services")}${mode ? "  " + c.y(mode) : ""}\n`);
    console.log(`  ${c.g("➜")} Dashboard   ${c.b(url + "/")}`);
    for (const p of stack.providers.values()) {
      const s = stack.settings.get(p.name)!;
      console.log(`  ${c.g("•")} ${p.name.padEnd(10)} ${url}/${p.name}  ${c.d(`[${p.category}]`)} scenario=${s.scenario === "success" ? c.g(s.scenario) : c.y(s.scenario)}${s.latency ? c.d(` latency=${s.latency}`) : ""}`);
    }
    if (stack.chaos.enabled) console.log(`\n  ${c.r("⚡ chaos")} category=${stack.chaos.category} rate=${stack.chaos.rate}`);
    if (stack.replay) console.log(`\n  ${c.y("⏵ replay")} ${stack.replay.fixtures.length} fixtures${cfg.replayStrict ? " (strict)" : ""}`);
    if (stack.record) console.log(`\n  ${c.r("● recording")} → ${stack.record.dir}  ${c.d(Object.entries(stack.record.upstreams).map(([k, v]) => `${k}=${v}`).join(" "))}`);
    console.log(`\n  ${c.d("Admin API: " + url + "/_mihan/health · Ctrl+C to stop")}\n`);
    const stop = () => run.close().then(() => process.exit(0));
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
  } catch (e) {
    const err = e as NodeJS.ErrnoException;
    if (err.code === "EADDRINUSE") die(`port ${cfg.port} is already in use (try --port)`);
    die(err.message);
  }
}

function serveOptions(cmd: Command): Command {
  return cmd
    .option("-c, --config <file>", "path to mihanstack.yml")
    .option("-p, --port <port>", `port (default ${DEFAULT_PORT}, or $PORT)`, int)
    .option("-H, --host <host>", "bind address (default 127.0.0.1; use 0.0.0.0 in Docker)")
    .option("--public-url <url>", "public base URL used in payment redirects")
    .option("-s, --scenario <svc=scenario>", "set a scenario, e.g. zarinpal=wrong_amount (repeatable)", collect)
    .option("-l, --latency <svc=ms>", 'add latency, e.g. kavenegar=300 or zibal="100-800" (repeatable)', collect)
    .option("--auto-redirect", "payment pages redirect immediately (no click needed; good for CI)");
}

const program = new Command();
program
  .name("mihanstack")
  .description("The local development cloud for Iranian services (Zarinpal, Zibal, Kavenegar, SMS.ir)")
  .version(VERSION, "-v, --version");

serveOptions(program.command("start", { isDefault: true }).description("start the emulator + dashboard (default command)"))
  .option("--chaos <category>", "enable chaos for: all | payment | sms | network | <service>")
  .option("--rate <0..1>", "chaos failure rate", rate)
  .option("--seed <n>", "seed for reproducible chaos", int)
  .option("--replay <dir>", "serve recorded fixtures from this directory")
  .option("--strict", "with --replay: 404 on unmatched requests instead of emulating")
  .action((f: ServeFlags) => serve(f));

program
  .command("init")
  .description("write a commented mihanstack.yml")
  .option("-f, --force", "overwrite an existing file")
  .action((o: { force?: boolean }) => {
    if (existsSync("mihanstack.yml") && !o.force) die("mihanstack.yml already exists (use --force)");
    writeFileSync("mihanstack.yml", SAMPLE_CONFIG);
    console.log(c.g("✓ wrote mihanstack.yml") + c.d("  next: npx mihanstack"));
  });

program
  .command("services")
  .alias("scenarios")
  .description("list emulated services, endpoints and scenarios")
  .option("-c, --config <file>", "path to mihanstack.yml (to include plugins)")
  .option("--json", "machine-readable output")
  .action(async (o: { config?: string; json?: boolean }) => {
    const cfg = loadConfig(o.config);
    const all = [...builtinProviders, ...(await loadPlugins(cfg.plugins, cfg.baseDir))];
    if (o.json) {
      console.log(JSON.stringify(all.map((p) => ({ name: p.name, category: p.category, hosts: p.hosts, scenarios: p.allScenarios, endpoints: p.endpoints.map((e) => `${e.method} ${e.path}`) })), null, 2));
      return;
    }
    for (const p of all) {
      console.log(`\n${c.b(p.displayName)} ${c.d(`(${p.name} · ${p.category} · ${p.hosts.join(", ")})`)}`);
      for (const e of p.endpoints) console.log(`  ${e.method.padEnd(5)} /${p.name}${e.path}${e.description ? c.d("  " + e.description) : ""}`);
      console.log(`  ${c.d("scenarios:")} ${p.allScenarios.join(", ")}`);
    }
  });

program
  .command("chaos")
  .description("inject random failures: all | payment | sms | network | <service>")
  .argument("<category>", "which services to break")
  .option("-r, --rate <0..1>", "probability that a request fails", rate, 0.3)
  .option("--seed <n>", "seed for reproducible chaos", int)
  .option("--off", "turn chaos off on a running instance")
  .option("-u, --url <url>", "running MihanStack to control", `http://localhost:${DEFAULT_PORT}`)
  .option("-p, --port <port>", "port when starting a new instance", int)
  .option("-c, --config <file>", "path to mihanstack.yml")
  .action(async (category: string, o: { rate: number; seed?: number; off?: boolean; url: string; port?: number; config?: string }) => {
    const base = o.url.replace(/\/$/, "");
    const running = await fetch(`${base}/_mihan/health`, { signal: AbortSignal.timeout(1500) }).then((r) => r.ok).catch(() => false);
    if (running) {
      const r = await fetch(`${base}/_mihan/chaos`, {
        method: o.off ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: o.off ? undefined : JSON.stringify({ enabled: true, category, rate: o.rate, seed: o.seed }),
      });
      const j = (await r.json()) as { error?: string; category?: string; rate?: number };
      if (!r.ok) die(j.error ?? `HTTP ${r.status}`);
      console.log(o.off ? c.g("✓ chaos off") : c.r(`⚡ chaos on: category=${j.category} rate=${j.rate}`) + c.d(`  (${base})`));
      return;
    }
    if (o.off) die(`no MihanStack running at ${base}`);
    await serve({ config: o.config, port: o.port, chaos: category, rate: o.rate, seed: o.seed }, {}, `chaos:${category}`);
  });

program
  .command("webhook")
  .description("send a fake provider callback to your app and show status + response time")
  .argument("<provider>", "zarinpal | zibal | kavenegar | custom")
  .requiredOption("-u, --url <url>", "your callback URL")
  .option("--status <ok|nok>", "payment/delivery result", "ok")
  .option("-P, --param <k=v>", "callback parameter, e.g. authority=A00… or trackId=123 (repeatable)", collect)
  .option("-n, --repeat <n>", "send N times (simulate duplicate callbacks)", int, 1)
  .option("--delay <ms>", "delay between repeats", int, 0)
  .option("--body <json>", "custom provider: request body")
  .option("--method <m>", "custom provider: HTTP method", "POST")
  .option("--json", "machine-readable output")
  .action(async (provider: string, o: { url: string; status: string; param?: string[]; repeat: number; delay: number; body?: string; method: string; json?: boolean }) => {
    if (o.status !== "ok" && o.status !== "nok") die("--status must be ok or nok");
    const providers = new Map(builtinProviders.map((p) => [p.name, p]));
    let req;
    try {
      req = buildWebhook(providers, { provider, url: o.url, status: o.status as "ok" | "nok", params: kv(o.param, "--param"), body: o.body, method: o.method });
    } catch (e) {
      die((e as Error).message);
    }
    const attempts = await sendWebhook(req, { repeat: o.repeat, delayMs: o.delay });
    if (o.json) {
      console.log(JSON.stringify({ request: req, attempts }, null, 2));
    } else {
      console.log(c.d(`${req.method} ${req.url}${req.body ? "  " + req.body : ""}`));
      for (const a of attempts) {
        const st = a.status == null ? c.r(a.error ?? "error") : a.ok ? c.g(String(a.status)) : c.y(String(a.status));
        console.log(`  #${a.attempt}  ${st}  ${String(a.ms).padStart(5)} ms  ${c.d((a.body ?? "").replace(/\s+/g, " ").slice(0, 80))}`);
      }
    }
    if (attempts.some((a) => !a.ok)) process.exitCode = 2;
  });

serveOptions(
  program
    .command("record")
    .description("proxy to real (sandbox) APIs and save redacted fixtures for offline replay")
    .requiredOption("-U, --upstream <svc=url>", "e.g. zarinpal=https://sandbox.zarinpal.com (repeatable)", collect)
    .option("-o, --out <dir>", "fixture directory", "fixtures"),
).action((f: ServeFlags & { upstream: string[]; out: string }) => {
  let upstreams: Record<string, string>;
  try {
    upstreams = kv(f.upstream, "--upstream");
  } catch (e) {
    die((e as Error).message);
  }
  return serve(f, { record: { upstreams, dir: f.out } }, "record");
});

serveOptions(
  program
    .command("replay")
    .description("serve recorded fixtures offline")
    .argument("[dir]", "fixture directory", "fixtures")
    .option("--strict", "404 on unmatched requests instead of falling back to emulation"),
).action((dir: string, f: ServeFlags) => serve({ ...f, replay: dir }, {}, "replay"));

program
  .command("inbox")
  .description("print SMS captured by a running MihanStack (OTP codes for your tests)")
  .option("-r, --receptor <mobile>", "only messages to this number")
  .option("--last", "only the latest message")
  .option("-u, --url <url>", "running MihanStack", `http://localhost:${DEFAULT_PORT}`)
  .action(async (o: { receptor?: string; last?: boolean; url: string }) => {
    const q = new URLSearchParams();
    if (o.receptor) q.set("receptor", o.receptor);
    if (o.last) q.set("last", "1");
    const r = await fetch(`${o.url.replace(/\/$/, "")}/_mihan/sms?${q}`).catch(() => die(`no MihanStack running at ${o.url}`));
    const list = (await r.json()) as { receptor: string; provider: string; message: string; at: string }[];
    if (!list.length) console.log(c.d("(empty)"));
    for (const m of list) console.log(`${c.d(m.at)}  ${m.provider.padEnd(9)} ${c.b(m.receptor)}  ${m.message}`);
  });

program.parseAsync().catch((e) => {
  if (e instanceof ConfigError) die(e.message);
  die((e as Error).message);
});

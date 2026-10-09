import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { receiver } from "./helpers.js";

const CLI = resolve("dist/cli.js");

beforeAll(() => {
  if (!existsSync(CLI)) spawnSync("npx", ["tsup"], { stdio: "ignore" });
});

const run = (args: string[], cwd = process.cwd()) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: "utf8", timeout: 15_000 });

/** Async variant: needed when the test process itself must serve HTTP (the receiver). */
const runAsync = (args: string[]) =>
  new Promise<{ status: number | null; stdout: string }>((res) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.on("exit", (status) => res({ status, stdout }));
  });

function startCli(args: string[]): Promise<{ url: string; kill: () => void; out: () => string }> {
  return new Promise((res, rej) => {
    const p = spawn(process.execPath, [CLI, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    const onData = (d: Buffer) => {
      out += d.toString();
      // The banner is complete once the "Admin API" line (printed last) has arrived.
      const m = out.match(/Dashboard\s+(\S+?)\/\s/);
      if (m && out.includes("Admin API")) res({ url: m[1], kill: () => p.kill("SIGTERM"), out: () => out });
    };
    p.stdout.on("data", onData);
    p.stderr.on("data", onData);
    p.on("exit", (code) => rej(new Error(`cli exited ${code}: ${out}`)));
  });
}

describe("cli", () => {
  let app: Awaited<ReturnType<typeof receiver>>;
  beforeAll(async () => {
    app = await receiver();
  });
  afterAll(() => app.close());

  it("--version and services --json", () => {
    expect(run(["--version"]).stdout.trim()).toBe("0.1.1");
    const list = JSON.parse(run(["services", "--json"]).stdout);
    expect(list.map((p: { name: string }) => p.name)).toEqual(["zarinpal", "zibal", "kavenegar", "smsir"]);
  });

  it("init writes a sample config that loads", () => {
    const d = mkdtempSync(join(tmpdir(), "mihan-cli-"));
    expect(run(["init"], d).status).toBe(0);
    expect(readFileSync(join(d, "mihanstack.yml"), "utf8")).toContain("chaos:");
    expect(run(["init"], d).status).toBe(1);
  });

  it("webhook sends a zarinpal callback and prints timing", async () => {
    const r = await runAsync(["webhook", "zarinpal", "--url", `${app.url}/cb`, "-P", "authority=A1", "--repeat", "2", "--json"]);
    expect(r.status).toBe(0);
    const out = JSON.parse(r.stdout);
    expect(out.attempts).toHaveLength(2);
    expect(app.hits.at(-1)!.url).toBe("/cb?Authority=A1&Status=OK");
  });

  it("start with --scenario, then `chaos` controls the running instance", async () => {
    const srv = await startCli(["start", "--port", "0", "--scenario", "zibal=merchant_disabled"]);
    try {
      expect(srv.out()).toContain("scenario=merchant_disabled");
      const r = await fetch(`${srv.url}/zibal/v1/request`, { method: "POST", body: JSON.stringify({ merchant: "zibal", amount: 5000, callbackUrl: "http://x" }) });
      expect(((await r.json()) as any).result).toBe(103);
      const c = await runAsync(["chaos", "sms", "--rate", "0.5", "--url", srv.url]);
      expect(c.stdout).toContain("chaos on");
      expect(await (await fetch(`${srv.url}/_mihan/chaos`)).json()).toMatchObject({ enabled: true, category: "sms", rate: 0.5 });
      expect((await runAsync(["chaos", "sms", "--off", "--url", srv.url])).stdout).toContain("chaos off");
    } finally {
      srv.kill();
    }
  });

  it("rejects bad flags with a clear error", () => {
    const r = run(["start", "--scenario", "zarinpal"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/name=value/);
    const r2 = run(["start", "--port", "0", "--scenario", "zarinpal=explode"]);
    expect(r2.status).toBe(1);
    expect(r2.stderr).toContain('unknown scenario "explode"');
  });
});

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { ConfigError, loadConfig, parseConfig, parseLatencySpec, resolveLatency } from "../src/config.js";
import { defineProvider, matchPath } from "../src/provider.js";
import type { RunningStack } from "../src/server.js";
import { boot, get, post } from "./helpers.js";

const running: RunningStack[] = [];
afterAll(async () => {
  for (const r of running) await r.close();
});

describe("defineProvider", () => {
  it("validates definitions and adds transport scenarios", () => {
    const p = defineProvider({ name: "my-sms", category: "sms", scenarios: ["success", "failed"], endpoints: [{ method: "GET", path: "/ping", handler: () => ({ body: { ok: 1 } }) }] });
    expect(p.allScenarios).toEqual(["success", "failed", "timeout", "network_error", "server_error", "latency"]);
    expect(p.defaultScenario).toBe("success");
    expect(() => defineProvider({ name: "Bad Name", category: "x", scenarios: [], endpoints: [] } as any)).toThrow(/name/);
    expect(() => defineProvider({ name: "x", category: "x", scenarios: [], endpoints: [] })).toThrow(/endpoint/);
    expect(() => defineProvider({ name: "x", category: "x", scenarios: [], endpoints: [{ method: "GET", path: "nope", handler: () => ({}) }] })).toThrow(/start with/);
  });

  it("matchPath extracts params", () => {
    expect(matchPath("/v1/:apikey/sms/send.json", "/v1/ABC/sms/send.json")).toEqual({ apikey: "ABC" });
    expect(matchPath("/v1/:apikey/sms/send.json", "/v1/ABC/sms/other.json")).toBeNull();
  });

  it("inline providers work end-to-end with scenarios and state", async () => {
    const counter = defineProvider({
      name: "counter",
      category: "other",
      scenarios: ["success", "failed"],
      endpoints: [
        {
          method: "POST",
          path: "/hit/:id",
          handler: (ctx) => {
            const n = (ctx.state.get(ctx.req.params.id) ?? 0) + 1;
            ctx.state.set(ctx.req.params.id, n);
            return ctx.scenario === "failed" ? { status: 409, body: { n } } : { body: { n } };
          },
        },
      ],
    });
    const s = await boot({}, { providers: [counter] });
    running.push(s);
    expect((await post(`${s.url}/counter/hit/a`, {})).json.n).toBe(1);
    expect((await post(`${s.url}/counter/hit/a`, {})).json.n).toBe(2);
    expect((await post(`${s.url}/counter/hit/a`, {}, { "x-mihan-scenario": "failed" })).status).toBe(409);
    expect((await post(`${s.url}/counter/hit/a`, {}, { "x-mihan-scenario": "server_error" })).status).toBe(500);
  });

  it("loads the example plugin file from config (plain object, no dependency)", async () => {
    const s = await boot({ plugins: [resolve("examples/plugins/idpay.mjs")] });
    running.push(s);
    expect(s.stack.providers.has("idpay")).toBe(true);
    const created = await post(`${s.url}/idpay/v1.1/payment`, { order_id: "1", amount: 10000, callback: "http://x" }, { "x-api-key": "k" });
    expect(created.status).toBe(201);
    const v = await post(`${s.url}/idpay/v1.1/payment/verify`, { id: created.json.id, order_id: "1" });
    expect(v.json.status).toBe(100);
    expect((await get(`${s.url}/_mihan/services`)).json.map((x: { name: string }) => x.name)).toContain("idpay");
  });
});

describe("config", () => {
  it("parses mihanstack.yml with env expansion, shorthand and latency specs", () => {
    process.env.MIHAN_TEST_KEY = "k-123";
    const cfg = parseConfig({
      port: 9000,
      services: { zarinpal: "failed", kavenegar: { latency: "100-300ms", options: { apiKeys: ["${MIHAN_TEST_KEY}"] } } },
      chaos: { category: "sms", rate: 0.5 },
    });
    expect(cfg.port).toBe(9000);
    expect(cfg.services.zarinpal.scenario).toBe("failed");
    expect(cfg.services.kavenegar.latency).toBe("100-300");
    expect(cfg.services.kavenegar.options!.apiKeys).toEqual(["k-123"]);
    expect(cfg.chaos).toMatchObject({ enabled: true, category: "sms", rate: 0.5 });
  });

  it("rejects invalid values", () => {
    expect(() => parseConfig({ port: "abc" })).toThrow(ConfigError);
    expect(() => parseConfig({ chaos: { rate: 3 } })).toThrow(ConfigError);
    expect(() => parseLatencySpec("fast")).toThrow(ConfigError);
    expect(() => parseConfig([])).toThrow(ConfigError);
  });

  it("resolveLatency handles numbers and ranges", () => {
    expect(resolveLatency(50)).toBe(50);
    expect(resolveLatency("100-200", () => 0.5)).toBe(150);
  });

  it("loads from disk and fails on unknown scenarios at startup", async () => {
    const d = mkdtempSync(join(tmpdir(), "mihan-cfg-"));
    writeFileSync(join(d, "mihanstack.yml"), "port: 0\nservices:\n  zibal:\n    scenario: teleport\n");
    const cfg = loadConfig(undefined, d);
    await expect(boot(cfg)).rejects.toThrow(/unknown scenario "teleport"/);
  });
});

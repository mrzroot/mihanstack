// Core engine over HTTP: host/path routing, scenarios (errors, network faults, latency), admin API, secret redaction in the request log, and chaos mode.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { REDACTED } from "../src/redact.js";
import type { RunningStack } from "../src/server.js";
import { boot, get, MERCHANT, post } from "./helpers.js";

let s: RunningStack;
beforeAll(async () => {
  s = await boot();
});
afterAll(() => s.close());
beforeEach(() => {
  s.stack.reset();
  s.stack.setChaos({ enabled: false, category: "all", rate: 0.3 });
  for (const n of s.stack.providers.keys()) s.stack.updateService(n, { scenario: "success", latency: 0, timeoutMs: 300, slowMs: 150, enabled: true });
});

const zpReq = (headers: Record<string, string> = {}) =>
  post(`${s.url}/zarinpal/pg/v4/payment/request.json`, { merchant_id: MERCHANT, amount: 10000, callback_url: "http://x/cb", description: "d" }, headers);

describe("routing", () => {
  it("serves the dashboard at / (RTL-aware, offline, Persian strings)", async () => {
    const r = await get(`${s.url}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    expect(r.text).toContain("ابر توسعهٔ محلی برای سرویس‌های ایرانی");
    expect(r.text).toContain('document.documentElement.dir = lang === "fa" ? "rtl" : "ltr"');
    expect(r.text).not.toMatch(/https?:\/\/(fonts|cdn)\./);
  });

  it("routes by Host header, e.g. when api.kavenegar.com is pointed at MihanStack", async () => {
    const port = new URL(s.url).port;
    const r = await fetch(`${s.url}/v1/KEY/account/info.json`, { headers: { host: `api.kavenegar.com:${port}` } });
    expect(r.status).toBe(200);
  });

  it("404 with a hint for unknown paths, 405 for wrong method", async () => {
    const r = await get(`${s.url}/nothing/here`);
    expect(r.status).toBe(404);
    expect(r.json.hint).toContain("/zarinpal");
    expect((await get(`${s.url}/zarinpal/pg/v4/payment/request.json`)).status).toBe(405);
  });
});

describe("scenarios", () => {
  it("per-request override via X-Mihan-Scenario; unknown scenario → 400", async () => {
    expect((await zpReq({ "x-mihan-scenario": "merchant_disabled" })).json.errors.code).toBe(-11);
    const bad = await zpReq({ "x-mihan-scenario": "explode" });
    expect(bad.status).toBe(400);
    expect(bad.json.available).toContain("timeout");
  });

  it("server_error → 500", async () => {
    expect((await zpReq({ "x-mihan-scenario": "server_error" })).status).toBe(500);
  });

  it("network_error → connection reset (fetch rejects)", async () => {
    await expect(zpReq({ "x-mihan-scenario": "network_error" })).rejects.toThrow();
  });

  it("timeout → holds the connection then drops it", async () => {
    const t = Date.now();
    await expect(zpReq({ "x-mihan-scenario": "timeout" })).rejects.toThrow();
    expect(Date.now() - t).toBeGreaterThanOrEqual(280);
  });

  it("latency scenario and latency setting delay the response", async () => {
    let t = Date.now();
    expect((await zpReq({ "x-mihan-scenario": "latency" })).json.data.code).toBe(100);
    expect(Date.now() - t).toBeGreaterThanOrEqual(140);
    s.stack.updateService("zarinpal", { latency: "100-120" });
    t = Date.now();
    await zpReq();
    expect(Date.now() - t).toBeGreaterThanOrEqual(95);
  });

  it("disabled service → 503", async () => {
    s.stack.updateService("zibal", { enabled: false });
    expect((await post(`${s.url}/zibal/v1/request`, {})).status).toBe(503);
  });
});

describe("admin API", () => {
  it("health, services, update with validation", async () => {
    expect((await get(`${s.url}/_mihan/health`)).json.services).toEqual(["zarinpal", "zibal", "kavenegar", "smsir"]);
    const svcs = (await get(`${s.url}/_mihan/services`)).json;
    expect(svcs.find((x: { name: string }) => x.name === "zarinpal").scenarios).toEqual(
      expect.arrayContaining(["success", "failed", "duplicate_callback", "wrong_amount", "invalid_signature", "merchant_disabled", "timeout", "network_error", "server_error", "latency"]),
    );
    const r = await fetch(`${s.url}/_mihan/services/zarinpal`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ scenario: "failed", latency: "10-20" }) });
    expect(((await r.json()) as any).scenario).toBe("failed");
    const bad = await fetch(`${s.url}/_mihan/services/zarinpal`, { method: "PUT", body: JSON.stringify({ scenario: "nope" }) });
    expect(bad.status).toBe(400);
  });

  it("request log redacts secrets", async () => {
    await zpReq();
    const logs = (await get(`${s.url}/_mihan/logs?service=zarinpal`)).json;
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ service: "zarinpal", method: "POST", status: 200, scenario: "success" });
    expect(logs[0].request.body.merchant_id).toBe(REDACTED);
    expect(JSON.stringify(logs)).not.toContain(MERCHANT);
  });

  it("kavenegar API key in the URL path is redacted in logs", async () => {
    await get(`${s.url}/kavenegar/v1/SECRETKEY123/account/info.json`);
    const logs = (await get(`${s.url}/_mihan/logs?service=kavenegar`)).json;
    expect(logs[0].path).toBe(`/v1/${REDACTED}/account/info.json`);
  });

  it("transactions endpoint", async () => {
    await zpReq();
    const tx = (await get(`${s.url}/_mihan/transactions`)).json;
    expect(tx.zarinpal).toHaveLength(1);
    expect(tx.zarinpal[0].merchant_id).toBe(REDACTED);
  });
});

describe("chaos", () => {
  it("rate 1 + seed: every payment request fails with a non-success scenario, flagged in the log", async () => {
    s.stack.updateService("zarinpal", { timeoutMs: 50, slowMs: 10 });
    s.stack.setChaos({ enabled: true, category: "payment", rate: 1, seed: 42 });
    for (let i = 0; i < 6; i++) await zpReq().catch(() => null);
    const logs = (await get(`${s.url}/_mihan/logs?service=zarinpal`)).json;
    expect(logs.length).toBe(6);
    expect(logs.every((l: { chaos: boolean; scenario: string }) => l.chaos && l.scenario !== "success")).toBe(true);
  });

  it("category filter: sms chaos leaves payments alone", async () => {
    s.stack.setChaos({ enabled: true, category: "sms", rate: 1 });
    expect((await zpReq()).json.data.code).toBe(100);
  });

  it("network category only injects transport failures", async () => {
    for (const n of s.stack.providers.keys()) s.stack.updateService(n, { timeoutMs: 30, slowMs: 5 });
    s.stack.setChaos({ enabled: true, category: "network", rate: 1, seed: 7 });
    for (let i = 0; i < 8; i++) await zpReq().catch(() => null);
    const sc = new Set((await get(`${s.url}/_mihan/logs`)).json.map((l: { scenario: string }) => l.scenario));
    for (const x of sc) expect(["timeout", "network_error", "server_error", "latency"]).toContain(x);
  });

  it("rejects unknown categories and bad rates via the admin API", async () => {
    const r = await post(`${s.url}/_mihan/chaos`, { category: "banks", rate: 0.5 });
    expect(r.status).toBe(400);
    expect((await post(`${s.url}/_mihan/chaos`, { category: "all", rate: 2 })).status).toBe(400);
    const ok = await post(`${s.url}/_mihan/chaos`, { category: "zibal", rate: 0.5 });
    expect(ok.json).toMatchObject({ enabled: true, category: "zibal", rate: 0.5 });
  });
});

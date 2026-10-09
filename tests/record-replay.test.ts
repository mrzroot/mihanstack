import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { maskMobiles, redactValue, REDACTED } from "../src/redact.js";
import type { RunningStack } from "../src/server.js";
import { boot, get, MERCHANT, post } from "./helpers.js";

const dir = mkdtempSync(join(tmpdir(), "mihan-fixtures-"));
const running: RunningStack[] = [];
afterAll(async () => {
  for (const r of running) await r.close();
});

describe("redaction", () => {
  it("scrubs secrets and masks mobiles deeply", () => {
    const out = redactValue({ merchant_id: "abc", nested: [{ "X-API-KEY": "k", ok: "09121234567 called" }], amount: 1 }) as any;
    expect(out.merchant_id).toBe(REDACTED);
    expect(out.nested[0]["X-API-KEY"]).toBe(REDACTED);
    expect(out.nested[0].ok).toBe("0912***4567 called");
    expect(out.amount).toBe(1);
    expect(maskMobiles("+989121234567")).toBe("+98912***4567");
  });
});

describe("record → replay", () => {
  it("records a real flow through the proxy (secrets redacted) and replays it offline", async () => {
    // "Real" upstream: another MihanStack instance standing in for sandbox.zarinpal.com / api.kavenegar.com
    const upstream = await boot();
    running.push(upstream);
    const rec = await boot({}, { record: { upstreams: { zarinpal: `${upstream.url}/zarinpal`, kavenegar: `${upstream.url}/kavenegar` }, dir } });
    running.push(rec);

    const req = await post(`${rec.url}/zarinpal/pg/v4/payment/request.json`, { merchant_id: MERCHANT, amount: 25000, callback_url: "http://app/cb", description: "x" });
    expect(req.json.data.code).toBe(100);
    const authority = req.json.data.authority;
    await fetch(`${upstream.url}/zarinpal/pg/StartPay/${authority}?auto=1`, { redirect: "manual" });
    const ver = await post(`${rec.url}/zarinpal/pg/v4/payment/verify.json`, { merchant_id: MERCHANT, amount: 25000, authority });
    expect(ver.json.data.code).toBe(100);
    const sms = await get(`${rec.url}/kavenegar/v1/MYSECRETKEY/sms/send.json?receptor=09121234567&message=hello`);
    expect(sms.status).toBe(200);

    const zpFiles = readdirSync(join(dir, "zarinpal"));
    expect(zpFiles).toHaveLength(2);
    const all = [...zpFiles.map((f) => join(dir, "zarinpal", f)), ...readdirSync(join(dir, "kavenegar")).map((f) => join(dir, "kavenegar", f))]
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(all).not.toContain(MERCHANT);
    expect(all).not.toContain("MYSECRETKEY");
    expect(all).not.toContain("09121234567");
    expect(all).toContain(REDACTED);
    await upstream.close();

    // Offline replay, strict: no upstream, no emulation fallback
    const rep = await boot({ replay: dir, replayStrict: true });
    running.push(rep);
    const r1 = await post(`${rep.url}/zarinpal/pg/v4/payment/request.json`, { merchant_id: "ffffffff-ffff-ffff-ffff-ffffffffffff", amount: 25000, callback_url: "http://app/cb", description: "x" });
    expect(r1.headers.get("x-mihan-replay")).toBe("1");
    expect(r1.json.data.authority).toBe(authority);
    const r2 = await post(`${rep.url}/zarinpal/pg/v4/payment/verify.json`, { merchant_id: "other", amount: 25000, authority });
    expect(r2.json.data.ref_id).toBe(ver.json.data.ref_id);
    const r3 = await get(`${rep.url}/kavenegar/v1/ANOTHERKEY/sms/send.json?receptor=09121234567&message=hello`);
    expect(r3.json.return.status).toBe(200);
    const miss = await post(`${rep.url}/zibal/v1/request`, { merchant: "zibal", amount: 5000, callbackUrl: "http://x" });
    expect(miss.status).toBe(404);
  });
});

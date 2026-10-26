// Zarinpal emulation: happy path through StartPay, callback and verify; error codes (-9, -10, -11, -50, -51, -54); duplicate callbacks; inquiry.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunningStack } from "../src/server.js";
import { boot, get, MERCHANT, post, receiver, waitFor } from "./helpers.js";

let s: RunningStack;
let app: Awaited<ReturnType<typeof receiver>>;
const zp = () => `${s.url}/zarinpal/pg/v4/payment`;

beforeAll(async () => {
  s = await boot();
  app = await receiver();
});
afterAll(async () => {
  await s.close();
  await app.close();
});
beforeEach(() => {
  s.stack.reset();
  s.stack.updateService("zarinpal", { scenario: "success", autoRedirect: false });
  app.hits.length = 0;
});

async function createPayment(amount = 10000, headers: Record<string, string> = {}) {
  return post(`${zp()}/request.json`, { merchant_id: MERCHANT, amount, callback_url: `${app.url}/cb?order=7`, description: "خرید تست" }, headers);
}

describe("zarinpal v4", () => {
  it("full happy path: request → StartPay → callback → verify (100) → re-verify (101)", async () => {
    const r = await createPayment();
    expect(r.status).toBe(200);
    expect(r.json.errors).toEqual([]);
    expect(r.json.data.code).toBe(100);
    const authority = r.json.data.authority;
    expect(authority).toMatch(/^A[0-9A-Za-z]{35}$/);

    const page = await get(`${s.url}/zarinpal/pg/StartPay/${authority}`);
    expect(page.status).toBe(200);
    expect(page.text).toContain('dir="rtl"');
    expect(page.text).toContain("زرین‌پال");

    const pay = await fetch(`${s.url}/zarinpal/pg/StartPay/${authority}/pay`, { method: "POST", redirect: "manual" });
    expect(pay.status).toBe(302);
    const loc = new URL(pay.headers.get("location")!);
    expect(loc.searchParams.get("Authority")).toBe(authority);
    expect(loc.searchParams.get("Status")).toBe("OK");
    expect(loc.searchParams.get("order")).toBe("7");

    const v = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 10000, authority });
    expect(v.json.data.code).toBe(100);
    expect(v.json.data.ref_id).toBeGreaterThan(0);
    expect(v.json.data.card_pan).toMatch(/^\d{6}\*{6}\d{4}$/);

    const again = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 10000, authority });
    expect(again.json.data.code).toBe(101);
    expect(again.json.data.ref_id).toBe(v.json.data.ref_id);
  });

  it("validation errors use code -9 with field messages", async () => {
    const r = await post(`${zp()}/request.json`, { merchant_id: "short", amount: 10 });
    expect(r.status).toBe(400);
    expect(r.json.data).toEqual([]);
    expect(r.json.errors.code).toBe(-9);
    const fields = r.json.errors.validations.flatMap((v: object) => Object.keys(v));
    expect(fields).toEqual(expect.arrayContaining(["merchant_id", "amount", "callback_url", "description"]));
  });

  it("cancel on the bank page → Status=NOK and verify -51", async () => {
    const { json } = await createPayment();
    const res = await fetch(`${s.url}/zarinpal/pg/StartPay/${json.data.authority}/cancel`, { method: "POST", redirect: "manual" });
    expect(new URL(res.headers.get("location")!).searchParams.get("Status")).toBe("NOK");
    const v = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 10000, authority: json.data.authority });
    expect(v.json.errors.code).toBe(-51);
  });

  it("autoRedirect + failed scenario sends NOK without a click", async () => {
    s.stack.updateService("zarinpal", { autoRedirect: true, scenario: "failed" });
    const { json } = await createPayment();
    const res = await get(`${s.url}/zarinpal/pg/StartPay/${json.data.authority}`);
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("Status=NOK");
  });

  it("wrong_amount → verify -50", async () => {
    const { json } = await createPayment(10000, { "x-mihan-scenario": "wrong_amount" });
    await fetch(`${s.url}/zarinpal/pg/StartPay/${json.data.authority}?auto=1`, { redirect: "manual" });
    const v = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 10000, authority: json.data.authority });
    expect(v.json.errors.code).toBe(-50);
  });

  it("a real amount mismatch also yields -50", async () => {
    const { json } = await createPayment(10000);
    await fetch(`${s.url}/zarinpal/pg/StartPay/${json.data.authority}?auto=1`, { redirect: "manual" });
    const v = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 20000, authority: json.data.authority });
    expect(v.json.errors.code).toBe(-50);
  });

  it("merchant_disabled → -11, invalid_signature → -10", async () => {
    expect((await createPayment(10000, { "x-mihan-scenario": "merchant_disabled" })).json.errors.code).toBe(-11);
    expect((await createPayment(10000, { "x-mihan-scenario": "invalid_signature" })).json.errors.code).toBe(-10);
  });

  it("restricting merchants rejects unknown merchant_id with -10", async () => {
    s.stack.updateService("zarinpal", { options: { merchants: ["00000000-0000-0000-0000-000000000000"] } });
    expect((await createPayment()).json.errors.code).toBe(-10);
    s.stack.updateService("zarinpal", { options: { merchants: [] } });
  });

  it("unknown authority → -54", async () => {
    const v = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 10000, authority: "A" + "0".repeat(35) });
    expect(v.json.errors.code).toBe(-54);
  });

  it("duplicate_callback hits the app twice (browser redirect + server-side resend)", async () => {
    s.stack.updateService("zarinpal", { scenario: "duplicate_callback" });
    const { json } = await createPayment();
    const res = await fetch(`${s.url}/zarinpal/pg/StartPay/${json.data.authority}?auto=1`); // follows redirect to app
    expect(res.status).toBe(200);
    await waitFor(() => app.hits.length >= 2);
    expect(app.hits.every((h) => h.url.includes(`Authority=${json.data.authority}`) && h.url.includes("Status=OK"))).toBe(true);
    const v1 = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 10000, authority: json.data.authority });
    const v2 = await post(`${zp()}/verify.json`, { merchant_id: MERCHANT, amount: 10000, authority: json.data.authority });
    expect([v1.json.data.code, v2.json.data.code]).toEqual([100, 101]);
  });

  it("inquiry reports the transaction status", async () => {
    const { json } = await createPayment();
    const q = await post(`${zp()}/inquiry.json`, { merchant_id: MERCHANT, authority: json.data.authority });
    expect(q.json.data.status).toBe("IN_BANK");
  });
});

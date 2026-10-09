import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunningStack } from "../src/server.js";
import { boot, get, post } from "./helpers.js";

let s: RunningStack;
const zb = (p: string) => `${s.url}/zibal${p}`;

beforeAll(async () => {
  s = await boot({ services: { zibal: { options: { merchants: ["zibal"] } } } });
});
afterAll(() => s.close());
beforeEach(() => {
  s.stack.reset();
  s.stack.updateService("zibal", { scenario: "success" });
});

const request = (extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) =>
  post(zb("/v1/request"), { merchant: "zibal", amount: 50000, callbackUrl: "http://localhost:3000/zb", orderId: "ORD-1", ...extra }, headers);

describe("zibal v1", () => {
  it("request → start → callback → verify (100) → verify again (201)", async () => {
    const r = await request();
    expect(r.json).toMatchObject({ result: 100, message: "success" });
    const trackId = r.json.trackId;
    expect(String(trackId)).toMatch(/^\d{10}$/);

    const page = await get(zb(`/start/${trackId}`));
    expect(page.text).toContain("زیبال");
    const res = await fetch(zb(`/start/${trackId}/pay`), { method: "POST", redirect: "manual" });
    const loc = new URL(res.headers.get("location")!);
    expect(Object.fromEntries(loc.searchParams)).toEqual({ success: "1", trackId: String(trackId), status: "2", orderId: "ORD-1" });

    const v = await post(zb("/v1/verify"), { merchant: "zibal", trackId });
    expect(v.json).toMatchObject({ result: 100, status: 1, amount: 50000, orderId: "ORD-1" });
    expect(v.json.refNumber).toBeGreaterThan(0);
    expect((await post(zb("/v1/verify"), { merchant: "zibal", trackId })).json.result).toBe(201);
  });

  it("error results: 102 unknown merchant, 103 disabled, 105 small amount, 106 bad callback, 203 bad trackId", async () => {
    expect((await request({ merchant: "nope" })).json.result).toBe(102);
    expect((await request({}, { "x-mihan-scenario": "merchant_disabled" })).json.result).toBe(103);
    expect((await request({ amount: 500 })).json.result).toBe(105);
    expect((await request({ callbackUrl: "ftp://x" })).json.result).toBe(106);
    expect((await post(zb("/v1/verify"), { merchant: "zibal", trackId: 1 })).json.result).toBe(203);
  });

  it("cancel → success=0 status=3 and verify 202", async () => {
    const { json } = await request();
    const res = await fetch(zb(`/start/${json.trackId}/cancel`), { method: "POST", redirect: "manual" });
    expect(res.headers.get("location")).toContain("success=0");
    expect(res.headers.get("location")).toContain("status=3");
    expect((await post(zb("/v1/verify"), { merchant: "zibal", trackId: json.trackId })).json.result).toBe(202);
  });

  it("wrong_amount: verify succeeds but reports a different amount (your code must catch it)", async () => {
    const { json } = await request({}, { "x-mihan-scenario": "wrong_amount" });
    await fetch(zb(`/start/${json.trackId}?auto=1`), { redirect: "manual" });
    const v = await post(zb("/v1/verify"), { merchant: "zibal", trackId: json.trackId });
    expect(v.json.result).toBe(100);
    expect(v.json.amount).not.toBe(50000);
  });

  it("routes without the /zibal prefix when the path is unambiguous", async () => {
    const r = await post(`${s.url}/v1/request`, { merchant: "zibal", amount: 50000, callbackUrl: "http://x/y" });
    expect(r.json.result).toBe(100);
  });

  it("inquiry", async () => {
    const { json } = await request();
    const q = await post(zb("/v1/inquiry"), { merchant: "zibal", trackId: json.trackId });
    expect(q.json).toMatchObject({ result: 100, status: -1, amount: 50000 });
  });
});

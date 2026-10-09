import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { RunningStack } from "../src/server.js";
import { boot, get, post } from "./helpers.js";

let s: RunningStack;
beforeAll(async () => {
  s = await boot({
    services: {
      kavenegar: { options: { apiKeys: ["GOODKEY"], templates: { verify: "کد تایید شما: %token%" } } },
      smsir: { options: { apiKeys: ["SMSIRKEY"], templates: { "100000": "کد ورود شما #CODE# است" } } },
    },
  });
});
afterAll(() => s.close());
beforeEach(() => {
  s.stack.reset();
  s.stack.updateService("kavenegar", { scenario: "success" });
  s.stack.updateService("smsir", { scenario: "success" });
});

const kv = (path: string) => `${s.url}/kavenegar/v1/GOODKEY${path}`;

describe("kavenegar", () => {
  it("sms/send via GET query returns Kavenegar's envelope and lands in the inbox", async () => {
    const r = await get(kv("/sms/send.json?receptor=09121234567,09351234567&sender=10004346&message=" + encodeURIComponent("سلام دنیا")));
    expect(r.status).toBe(200);
    expect(r.json.return).toEqual({ status: 200, message: "تایید شد" });
    expect(r.json.entries).toHaveLength(2);
    expect(r.json.entries[0]).toMatchObject({ status: 1, statustext: "در صف ارسال", sender: "10004346", receptor: "09121234567", message: "سلام دنیا" });
    const inbox = await get(`${s.url}/_mihan/sms?receptor=+989351234567`);
    expect(inbox.json).toHaveLength(1);
    expect(inbox.json[0].message).toBe("سلام دنیا");
  });

  it("sms/send via POST form works too", async () => {
    const r = await fetch(kv("/sms/send.json"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ receptor: "09121234567", message: "hi" }),
    });
    expect(r.status).toBe(200);
  });

  it("verify/lookup renders the template (OTP visible to tests)", async () => {
    const r = await get(kv("/verify/lookup.json?receptor=09121234567&token=4521&template=verify"));
    expect(r.json.entries[0].message).toBe("کد تایید شما: 4521");
    const last = await get(`${s.url}/_mihan/sms?receptor=09121234567&last=1`);
    expect(last.json[0].tokens.token).toBe("4521");
  });

  it("error statuses mirror the HTTP status: 403 bad key, 424 template, 411 receptor, 400 params, 418 credit, 401 disabled", async () => {
    expect((await get(`${s.url}/kavenegar/v1/BADKEY/sms/send.json?receptor=09121234567&message=x`)).status).toBe(403);
    expect((await get(kv("/verify/lookup.json?receptor=09121234567&token=1&template=nope"))).json.return.status).toBe(424);
    expect((await get(kv("/sms/send.json?receptor=12345&message=x"))).status).toBe(411);
    expect((await get(kv("/sms/send.json?receptor=09121234567"))).status).toBe(400);
    expect((await get(kv("/sms/send.json?receptor=09121234567&message=x"), { "x-mihan-scenario": "failed" })).json.return).toMatchObject({ status: 418, message: "اعتبار حساب شما کافی نیست" });
    expect((await get(kv("/account/info.json"), { "x-mihan-scenario": "merchant_disabled" })).status).toBe(401);
  });

  it("sms/status reports delivered (10) for known ids and 100 for unknown", async () => {
    const sent = await get(kv("/sms/send.json?receptor=09121234567&message=x"));
    const id = sent.json.entries[0].messageid;
    const st = await get(kv(`/sms/status.json?messageid=${id},42`));
    expect(st.json.entries.map((e: { status: number }) => e.status)).toEqual([10, 100]);
  });
});

describe("sms.ir v1", () => {
  const H = { "x-api-key": "SMSIRKEY" };
  it("send/bulk", async () => {
    const r = await post(`${s.url}/smsir/v1/send/bulk`, { lineNumber: 30007732000000, messageText: "تست", mobiles: ["09121234567", "09131234567"] }, H);
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 1, message: "موفق" });
    expect(r.json.data.messageIds).toHaveLength(2);
    expect(r.json.data.packId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("send/verify fills template parameters", async () => {
    const r = await post(`${s.url}/smsir/v1/send/verify`, { mobile: "09121234567", templateId: 100000, parameters: [{ name: "CODE", value: "98765" }] }, H);
    expect(r.json.status).toBe(1);
    const inbox = await get(`${s.url}/_mihan/sms?receptor=09121234567&last=1`);
    expect(inbox.json[0].message).toBe("کد ورود شما 98765 است");
  });

  it("errors: 10 bad key (401), 101 bad line, 104 bad mobile, 107 empty, 113 template, 102 credit", async () => {
    const bad = await post(`${s.url}/smsir/v1/send/bulk`, {}, { "x-api-key": "nope" });
    expect(bad.status).toBe(401);
    expect(bad.json.status).toBe(10);
    expect((await post(`${s.url}/smsir/v1/send/bulk`, { lineNumber: 1, messageText: "x", mobiles: ["09121234567"] }, H)).json.status).toBe(101);
    expect((await post(`${s.url}/smsir/v1/send/bulk`, { lineNumber: 30007732000000, messageText: "x", mobiles: ["123"] }, H)).json.status).toBe(104);
    expect((await post(`${s.url}/smsir/v1/send/bulk`, { lineNumber: 30007732000000, messageText: "x", mobiles: [] }, H)).json.status).toBe(107);
    expect((await post(`${s.url}/smsir/v1/send/verify`, { mobile: "09121234567", templateId: 5, parameters: [] }, H)).json.status).toBe(113);
    expect((await post(`${s.url}/smsir/v1/send/bulk`, { lineNumber: 30007732000000, messageText: "x", mobiles: ["09121234567"] }, { ...H, "x-mihan-scenario": "failed" })).json.status).toBe(102);
  });

  it("credit and line", async () => {
    expect((await get(`${s.url}/smsir/v1/credit`, H)).json.data).toBe(6417.5);
    expect((await get(`${s.url}/smsir/v1/line`, H)).json.data).toEqual([30007732000000]);
  });
});

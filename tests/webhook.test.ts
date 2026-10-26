// Webhook playground: provider-shaped callbacks, sending/repeating with timing, error reporting, admin API.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { builtinProviders } from "../src/providers/index.js";
import type { RunningStack } from "../src/server.js";
import { buildWebhook, sendWebhook } from "../src/webhook.js";
import { boot, post, receiver } from "./helpers.js";

const providers = new Map(builtinProviders.map((p) => [p.name, p]));
let app: Awaited<ReturnType<typeof receiver>>;
let s: RunningStack;

beforeAll(async () => {
  app = await receiver((req) => (req.url?.includes("slow") ? { delay: 120, body: "slow ok" } : req.url?.includes("boom") ? { status: 500, body: "boom" } : { body: "thanks" }));
  s = await boot();
});
afterAll(async () => {
  await app.close();
  await s.close();
});

describe("webhook playground", () => {
  it("builds provider-shaped callbacks", () => {
    const zp = buildWebhook(providers, { provider: "zarinpal", url: "http://app/cb?x=1", status: "nok", params: { authority: "A123" } });
    expect(zp).toMatchObject({ method: "GET" });
    expect(zp.url).toBe("http://app/cb?x=1&Authority=A123&Status=NOK");
    const zb = buildWebhook(providers, { provider: "zibal", url: "http://app/cb", status: "ok", params: { trackId: "9" } });
    expect(new URL(zb.url).searchParams.get("success")).toBe("1");
    const kv = buildWebhook(providers, { provider: "kavenegar", url: "http://app/dlr", status: "ok", params: { messageid: "55" } });
    expect(kv).toMatchObject({ method: "POST", body: "messageid=55&status=10" });
    expect(() => buildWebhook(providers, { provider: "smsir", url: "http://app" })).toThrow(/custom/);
    expect(() => buildWebhook(providers, { provider: "zarinpal", url: "not a url" })).toThrow(/invalid url/);
  });

  it("sends, repeats and measures response time", async () => {
    const req = buildWebhook(providers, { provider: "zarinpal", url: `${app.url}/slow`, status: "ok" });
    const res = await sendWebhook(req, { repeat: 2 });
    expect(res).toHaveLength(2);
    expect(res.every((a) => a.ok && a.status === 200 && a.ms >= 100 && a.body === "slow ok")).toBe(true);
  });

  it("reports HTTP errors and unreachable targets", async () => {
    const [boom] = await sendWebhook(buildWebhook(providers, { provider: "custom", url: `${app.url}/boom`, body: '{"a":1}' }));
    expect(boom).toMatchObject({ ok: false, status: 500 });
    const [dead] = await sendWebhook(buildWebhook(providers, { provider: "custom", url: "http://127.0.0.1:1/x" }));
    expect(dead.ok).toBe(false);
    expect(dead.status).toBeNull();
    expect(dead.error).toBeTruthy();
  });

  it("is available through the admin API and logged", async () => {
    const r = await post(`${s.url}/_mihan/webhook`, { provider: "zibal", url: `${app.url}/zb`, status: "ok", repeat: 3 });
    expect(r.json.attempts).toHaveLength(3);
    const logs = await (await fetch(`${s.url}/_mihan/logs?service=webhook`)).json();
    expect(logs).toHaveLength(3);
  });
});

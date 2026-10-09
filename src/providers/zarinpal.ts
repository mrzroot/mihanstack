import { defineProvider } from "../provider.js";
import type { HandlerContext, MihanResponse } from "../types.js";
import { maskedPan, paymentPage, withQuery } from "./payment-page.js";

/**
 * Zarinpal REST v4 (https://www.zarinpal.com/docs/paymentGateway/).
 * Real hosts: payment.zarinpal.com, sandbox.zarinpal.com
 */

export const ZARINPAL_ERRORS: Record<number, string> = {
  [-9]: "The input params invalid, validation error.",
  [-10]: "Terminal is not valid, please check merchant_id or ip address.",
  [-11]: "Terminal is not active, please contact our support team.",
  [-12]: "To many attempts, please try again later.",
  [-15]: "Terminal user is suspend : (please contact our support team).",
  [-16]: "Terminal user level is not valid : ( please contact our support team).",
  [-50]: "Session is not valid, amounts values is not the same.",
  [-51]: "Session is not valid, session is not active paid try.",
  [-52]: "Oops!!, please contact our support team",
  [-53]: "Session is not this merchant_id session",
  [-54]: "Invalid authority.",
};

interface ZpTx {
  authority: string;
  merchant_id: string;
  amount: number;
  callback_url: string;
  description: string;
  status: "pending" | "paid" | "failed" | "verified";
  ref_id?: number;
  card_pan?: string;
  scenario: string;
  /** Set when wrong_amount was active at request, payment or verify time. */
  wrongAmount?: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function err(code: number, status = code === -9 ? 400 : 200, validations?: unknown): MihanResponse {
  const errors: Record<string, unknown> = { code, message: ZARINPAL_ERRORS[code] ?? "Error", validations: validations ?? [] };
  return { status, body: { data: [], errors } };
}

function txs(ctx: HandlerContext): Map<string, ZpTx> {
  if (!ctx.state.has("tx")) ctx.state.set("tx", new Map());
  return ctx.state.get("tx");
}

function newAuthority(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let s = "A";
  while (s.length < 36) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

function request(ctx: HandlerContext): MihanResponse {
  const { body } = ctx.req;
  const { scenario } = ctx;
  const validations: Record<string, string>[] = [];
  if (!body.merchant_id) validations.push({ merchant_id: "The merchant id field is required." });
  else if (!UUID_RE.test(String(body.merchant_id))) validations.push({ merchant_id: "The merchant id must be 36 characters." });
  const amount = Number(body.amount);
  if (!body.amount && body.amount !== 0) validations.push({ amount: "The amount field is required." });
  else if (!Number.isFinite(amount) || amount < 1000) validations.push({ amount: "The amount must be at least 1000." });
  if (!body.callback_url) validations.push({ callback_url: "The callback url field is required." });
  else {
    try {
      new URL(String(body.callback_url));
    } catch {
      validations.push({ callback_url: "The callback url format is invalid." });
    }
  }
  if (!body.description) validations.push({ description: "The description field is required." });
  if (validations.length) return err(-9, 400, validations);

  const allowed: string[] = ctx.settings.options.merchants ?? [];
  if (scenario === "invalid_signature" || (allowed.length && !allowed.includes(String(body.merchant_id)))) return err(-10);
  if (scenario === "merchant_disabled") return err(-11);

  const authority = newAuthority();
  txs(ctx).set(authority, {
    authority,
    merchant_id: String(body.merchant_id),
    amount,
    callback_url: String(body.callback_url),
    description: String(body.description),
    status: "pending",
    scenario,
    wrongAmount: scenario === "wrong_amount",
  });
  const fee = Math.round(amount * 0.01);
  return {
    status: 200,
    body: { data: { code: 100, message: "Success", authority, fee_type: "Merchant", fee }, errors: [] },
  };
}

function startPay(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(ctx.req.params.authority);
  if (!tx) return { status: 404, html: "<h1 dir=rtl>تراکنش یافت نشد (Invalid authority)</h1>" };
  const scenario = ctx.req.query.mihan_scenario || ctx.scenario;
  if (ctx.settings.autoRedirect || ctx.req.query.auto === "1") {
    return settle(ctx, tx, scenario === "failed" ? "NOK" : "OK", scenario);
  }
  const base = `${ctx.baseUrl}/pg/StartPay/${tx.authority}`;
  return {
    html: paymentPage({
      title: "زرین‌پال",
      brand: "زرین‌پال · ZarinPal",
      color: "#f5b900",
      amount: tx.amount,
      description: tx.description,
      payUrl: `${base}/pay?mihan_scenario=${encodeURIComponent(scenario)}`,
      cancelUrl: `${base}/cancel`,
      scenario,
      id: tx.authority,
    }),
  };
}

function settle(ctx: HandlerContext, tx: ZpTx, status: "OK" | "NOK", scenario: string): MihanResponse {
  if (tx.status === "pending") tx.status = status === "OK" ? "paid" : "failed";
  tx.scenario = scenario;
  if (scenario === "wrong_amount") tx.wrongAmount = true;
  const url = withQuery(tx.callback_url, { Authority: tx.authority, Status: status });
  if (scenario === "duplicate_callback") ctx.fireCallback(url);
  return { redirect: url };
}

function pay(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(ctx.req.params.authority);
  if (!tx) return { status: 404, html: "Invalid authority" };
  const scenario = ctx.req.query.mihan_scenario || ctx.scenario;
  return settle(ctx, tx, scenario === "failed" ? "NOK" : "OK", scenario);
}

function cancel(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(ctx.req.params.authority);
  if (!tx) return { status: 404, html: "Invalid authority" };
  return settle(ctx, tx, "NOK", "failed");
}

function verify(ctx: HandlerContext): MihanResponse {
  const { body } = ctx.req;
  const validations: Record<string, string>[] = [];
  for (const k of ["merchant_id", "amount", "authority"]) if (!body[k]) validations.push({ [k]: `The ${k.replace("_", " ")} field is required.` });
  if (validations.length) return err(-9, 400, validations);
  const { scenario } = ctx;
  if (scenario === "invalid_signature") return err(-10);
  if (scenario === "merchant_disabled") return err(-11);

  const tx = txs(ctx).get(String(body.authority));
  if (!tx) return err(-54);
  if (tx.merchant_id !== String(body.merchant_id)) return err(-53);
  if (scenario === "wrong_amount" || tx.wrongAmount || Number(body.amount) !== tx.amount) return err(-50);
  if (scenario === "failed" || tx.status === "failed" || tx.status === "pending") return err(-51);

  const fee = Math.round(tx.amount * 0.01);
  if (tx.status === "verified") {
    return {
      body: {
        data: { code: 101, message: "Verified", card_hash: "1EBE3EBEBE35C7EC0F8D6EE4F2F859107A87822CA179BC9528767EA7B5489B69", card_pan: tx.card_pan, ref_id: tx.ref_id, fee_type: "Merchant", fee },
        errors: [],
      },
    };
  }
  tx.status = "verified";
  tx.ref_id = Number(ctx.randomId(9));
  tx.card_pan = maskedPan();
  return {
    body: {
      data: { code: 100, message: "Paid", card_hash: "1EBE3EBEBE35C7EC0F8D6EE4F2F859107A87822CA179BC9528767EA7B5489B69", card_pan: tx.card_pan, ref_id: tx.ref_id, fee_type: "Merchant", fee },
      errors: [],
    },
  };
}

function inquiry(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(String(ctx.req.body.authority));
  if (!tx) return err(-54);
  const map = { pending: "IN_BANK", paid: "PAID", failed: "FAILED", verified: "VERIFIED" } as const;
  return { body: { data: { code: 100, message: "Success", status: map[tx.status] }, errors: [] } };
}

export default defineProvider({
  name: "zarinpal",
  displayName: "Zarinpal · زرین‌پال",
  category: "payment",
  description: "Zarinpal payment gateway REST v4: request, StartPay, verify, inquiry.",
  hosts: ["payment.zarinpal.com", "sandbox.zarinpal.com", "api.zarinpal.com"],
  scenarios: ["success", "failed", "duplicate_callback", "wrong_amount", "invalid_signature", "merchant_disabled"],
  defaultOptions: { merchants: [] },
  endpoints: [
    { method: "POST", path: "/pg/v4/payment/request.json", handler: request, description: "Create a payment, returns authority" },
    { method: "GET", path: "/pg/StartPay/:authority", handler: startPay, description: "Fake bank page" },
    { method: "POST", path: "/pg/StartPay/:authority/pay", handler: pay },
    { method: "POST", path: "/pg/StartPay/:authority/cancel", handler: cancel },
    { method: "POST", path: "/pg/v4/payment/verify.json", handler: verify, description: "Verify a payment, returns ref_id" },
    { method: "POST", path: "/pg/v4/payment/inquiry.json", handler: inquiry },
  ],
  webhook: ({ url, status, params }) => ({
    method: "GET",
    url: withQuery(url, { Authority: params.authority ?? params.Authority ?? "A" + "0".repeat(35), Status: status === "ok" ? "OK" : "NOK" }),
  }),
  redact: { keys: ["merchant_id", "card_pan", "card_hash"] },
});

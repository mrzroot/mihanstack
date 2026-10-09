import { defineProvider } from "../provider.js";
import type { HandlerContext, MihanResponse } from "../types.js";
import { paymentPage, withQuery } from "./payment-page.js";

/**
 * Zibal gateway v1 (https://help.zibal.ir/IPG/API/).
 * Real host: gateway.zibal.ir. The merchant "zibal" is Zibal's public test merchant.
 */

export const ZIBAL_RESULTS: Record<number, string> = {
  100: "success",
  102: "merchant یافت نشد.",
  103: "merchant غیرفعال",
  104: "merchant نامعتبر",
  105: "amount بایستی بزرگتر از 1,000 ریال باشد.",
  106: "callbackUrl نامعتبر می‌باشد. (شروع با http و یا https)",
  113: "amount مبلغ تراکنش از سقف میزان تراکنش بیشتر است.",
  201: "قبلا تایید شده.",
  202: "سفارش پرداخت نشده یا ناموفق بوده است.",
  203: "trackId نامعتبر می‌باشد.",
};

/** Status codes reported on callback / inquiry. */
export const ZIBAL_STATUS: Record<number, string> = {
  [-1]: "در انتظار پرداخت",
  [-2]: "خطای داخلی",
  1: "پرداخت شده - تاییدشده",
  2: "پرداخت شده - تاییدنشده",
  3: "لغوشده توسط کاربر",
};

interface ZbTx {
  trackId: number;
  merchant: string;
  amount: number;
  callbackUrl: string;
  description?: string;
  orderId?: string;
  mobile?: string;
  status: -1 | 1 | 2 | 3;
  refNumber?: number;
  paidAt?: string;
  cardNumber?: string;
  scenario: string;
  /** Set when wrong_amount was active at request, payment or verify time. */
  wrongAmount?: boolean;
}

const res = (result: number, extra: Record<string, unknown> = {}): MihanResponse => ({
  body: { ...extra, result, message: ZIBAL_RESULTS[result] ?? "error" },
});

function txs(ctx: HandlerContext): Map<string, ZbTx> {
  if (!ctx.state.has("tx")) ctx.state.set("tx", new Map());
  return ctx.state.get("tx");
}

function request(ctx: HandlerContext): MihanResponse {
  const b = ctx.req.body;
  const { scenario } = ctx;
  const known: string[] = ctx.settings.options.merchants ?? [];
  if (!b.merchant || scenario === "invalid_signature" || (known.length && !known.includes(String(b.merchant)))) return res(102);
  if (scenario === "merchant_disabled") return res(103);
  const amount = Number(b.amount);
  if (!Number.isFinite(amount) || amount < 1000) return res(105);
  if (amount > Number(ctx.settings.options.maxAmount ?? 500_000_000_000)) return res(113);
  if (!/^https?:\/\//.test(String(b.callbackUrl ?? ""))) return res(106);
  const trackId = Number(ctx.randomId(10));
  txs(ctx).set(String(trackId), {
    trackId,
    merchant: String(b.merchant),
    amount,
    callbackUrl: String(b.callbackUrl),
    description: b.description,
    orderId: b.orderId != null ? String(b.orderId) : undefined,
    mobile: b.mobile,
    status: -1,
    scenario,
    wrongAmount: scenario === "wrong_amount",
  });
  return res(100, { trackId });
}

function settle(ctx: HandlerContext, tx: ZbTx, ok: boolean, scenario: string): MihanResponse {
  if (tx.status === -1) {
    tx.status = ok ? 2 : 3;
    if (ok) {
      tx.paidAt = new Date().toISOString().replace("Z", "");
      tx.cardNumber = "62741****" + String(10 + Math.floor(Math.random() * 89));
      tx.refNumber = Number(ctx.randomId(9));
    }
  }
  tx.scenario = scenario;
  if (scenario === "wrong_amount") tx.wrongAmount = true;
  const params: Record<string, string | number> = { success: ok ? 1 : 0, trackId: tx.trackId, status: tx.status };
  if (tx.orderId) params.orderId = tx.orderId;
  const url = withQuery(tx.callbackUrl, params);
  if (scenario === "duplicate_callback") ctx.fireCallback(url);
  return { redirect: url };
}

function start(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(ctx.req.params.trackId);
  if (!tx) return { status: 404, html: "<h1 dir=rtl>trackId نامعتبر</h1>" };
  const scenario = ctx.req.query.mihan_scenario || ctx.scenario;
  if (ctx.settings.autoRedirect || ctx.req.query.auto === "1") return settle(ctx, tx, scenario !== "failed", scenario);
  const base = `${ctx.baseUrl}/start/${tx.trackId}`;
  return {
    html: paymentPage({
      title: "زیبال",
      brand: "زیبال · Zibal",
      color: "#2f6df6",
      amount: tx.amount,
      description: tx.description,
      payUrl: `${base}/pay?mihan_scenario=${encodeURIComponent(scenario)}`,
      cancelUrl: `${base}/cancel`,
      scenario,
      id: String(tx.trackId),
    }),
  };
}

function pay(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(ctx.req.params.trackId);
  if (!tx) return { status: 404, html: "trackId نامعتبر" };
  const scenario = ctx.req.query.mihan_scenario || ctx.scenario;
  return settle(ctx, tx, scenario !== "failed", scenario);
}

function cancel(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(ctx.req.params.trackId);
  if (!tx) return { status: 404, html: "trackId نامعتبر" };
  return settle(ctx, tx, false, "failed");
}

function verify(ctx: HandlerContext): MihanResponse {
  const b = ctx.req.body;
  const { scenario } = ctx;
  if (!b.merchant || scenario === "invalid_signature") return res(102);
  if (scenario === "merchant_disabled") return res(103);
  const tx = txs(ctx).get(String(b.trackId));
  if (!tx || tx.merchant !== String(b.merchant)) return res(203);
  if (scenario === "failed" || tx.status === 3 || tx.status === -1) return res(202);
  // Zibal's verify does not take an amount; the merchant must compare the returned
  // amount with the order. wrong_amount returns a different amount to test that check.
  const amount = scenario === "wrong_amount" || tx.wrongAmount ? tx.amount - 10_000 : tx.amount;
  const payload = {
    paidAt: tx.paidAt,
    cardNumber: tx.cardNumber,
    status: 1,
    amount,
    refNumber: tx.refNumber,
    description: tx.description ?? "",
    orderId: tx.orderId ?? "",
  };
  if (tx.status === 1) return res(201, payload);
  tx.status = 1;
  return res(100, payload);
}

function inquiry(ctx: HandlerContext): MihanResponse {
  const tx = txs(ctx).get(String(ctx.req.body.trackId));
  if (!tx) return res(203);
  return res(100, {
    createdAt: new Date().toISOString(),
    paidAt: tx.paidAt,
    verifiedAt: tx.status === 1 ? new Date().toISOString() : null,
    status: tx.status,
    amount: tx.amount,
    refNumber: tx.refNumber,
    description: tx.description ?? "",
    cardNumber: tx.cardNumber,
    orderId: tx.orderId ?? "",
  });
}

export default defineProvider({
  name: "zibal",
  displayName: "Zibal · زیبال",
  category: "payment",
  description: "Zibal payment gateway v1: request, start page, verify, inquiry.",
  hosts: ["gateway.zibal.ir"],
  scenarios: ["success", "failed", "duplicate_callback", "wrong_amount", "invalid_signature", "merchant_disabled"],
  defaultOptions: { merchants: [], maxAmount: 500_000_000_000 },
  endpoints: [
    { method: "POST", path: "/v1/request", handler: request, description: "Create a payment, returns trackId" },
    { method: "GET", path: "/start/:trackId", handler: start, description: "Fake bank page" },
    { method: "POST", path: "/start/:trackId/pay", handler: pay },
    { method: "POST", path: "/start/:trackId/cancel", handler: cancel },
    { method: "POST", path: "/v1/verify", handler: verify, description: "Verify a payment" },
    { method: "POST", path: "/v1/inquiry", handler: inquiry },
  ],
  webhook: ({ url, status, params }) => ({
    method: "GET",
    url: withQuery(url, {
      success: status === "ok" ? 1 : 0,
      trackId: params.trackId ?? "1234567890",
      orderId: params.orderId ?? "1",
      status: status === "ok" ? 2 : 3,
    }),
  }),
  redact: { keys: ["merchant", "cardNumber", "mobile"] },
});

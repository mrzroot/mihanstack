import { defineProvider } from "../provider.js";
import type { HandlerContext, MihanResponse } from "../types.js";

/**
 * Kavenegar REST API (https://kavenegar.com/rest.html).
 * URL shape: https://api.kavenegar.com/v1/{API-KEY}/{scope}/{method}.json
 * Parameters may come as query string or form body; the HTTP status equals return.status.
 */

export const KAVENEGAR_STATUS: Record<number, string> = {
  200: "تایید شد",
  400: "پارامترها ناقص هستند",
  401: "حساب کاربری غیرفعال شده است",
  402: "عملیات ناموفق بود",
  403: "کد شناسائی API-Key معتبر نمی‌باشد",
  404: "متد نامشخص است",
  405: "متد Get/Post اشتباه است",
  406: "پارامترهای اجباری خالی ارسال شده اند",
  407: "دسترسی به اطلاعات مورد نظر برای شما امکان پذیر نیست",
  411: "دریافت کننده نامعتبر است",
  412: "ارسال کننده نامعتبر است",
  413: "پیام خالی است و یا طول پیام بیش از حد مجاز می‌باشد",
  414: "حجم درخواست بیشتر از حد مجاز است",
  418: "اعتبار حساب شما کافی نیست",
  422: "داده ها به دلیل وجود کاراکتر نامناسب قابل پردازش نیست",
  424: "الگوی مورد نظر پیدا نشد",
  431: "ساختار کد صحیح نمی‌باشد",
  432: "پارامتر کد در متن پیام پیدا نشد",
};

/** Delivery statuses of a message entry. */
export const KAVENEGAR_MESSAGE_STATUS: Record<number, string> = {
  1: "در صف ارسال",
  2: "زمان بندی شده",
  4: "ارسال شده به مخابرات",
  5: "ارسال شده به مخابرات",
  6: "خطا در ارسال پیام",
  10: "رسیده به گیرنده",
  11: "نرسیده به گیرنده",
  13: "ارسال پیام از سمت کاربر لغو شده یا در ارسال آن مشکلی پیش آمده",
  14: "بلاک شده است",
  100: "شناسه پیامک نامعتبر است",
};

const fail = (status: number): MihanResponse => ({
  status,
  body: { return: { status, message: KAVENEGAR_STATUS[status] ?? "خطا" }, entries: null },
});

const ok = (entries: unknown): MihanResponse => ({
  status: 200,
  body: { return: { status: 200, message: KAVENEGAR_STATUS[200] }, entries },
});

const MOBILE_RE = /^(\+98|0098|98|0)?9\d{9}$/;

function params(ctx: HandlerContext): Record<string, string> {
  return { ...ctx.req.query, ...ctx.req.body };
}

/** Common checks: API key, account state, scenario. Returns an error response or null. */
function guard(ctx: HandlerContext): MihanResponse | null {
  const keys: string[] = ctx.settings.options.apiKeys ?? [];
  const key = ctx.req.params.apikey;
  if (ctx.scenario === "invalid_signature" || !key || (keys.length && !keys.includes(key))) return fail(403);
  if (ctx.scenario === "merchant_disabled") return fail(401);
  return null;
}

function messages(ctx: HandlerContext): Map<number, any> {
  if (!ctx.state.has("messages")) ctx.state.set("messages", new Map());
  return ctx.state.get("messages");
}

function makeEntry(ctx: HandlerContext, receptor: string, sender: string, message: string, extra: Partial<{ template: string; tokens: Record<string, string> }> = {}) {
  const sms = ctx.sms({ receptor, sender, message, ...extra });
  const entry = {
    messageid: Number(ctx.randomId(9)),
    message,
    status: 1,
    statustext: KAVENEGAR_MESSAGE_STATUS[1],
    sender,
    receptor,
    date: Math.floor(Date.now() / 1000),
    cost: Math.max(1, Math.ceil(message.length / 70)) * Number(ctx.settings.options.costPerPart ?? 1180),
    _inbox: sms.id,
  };
  messages(ctx).set(entry.messageid, entry);
  const { _inbox, ...publicEntry } = entry;
  return publicEntry;
}

function send(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  if (g) return g;
  const p = params(ctx);
  if (!p.receptor || !p.message) return fail(400);
  if (ctx.scenario === "failed") return fail(418);
  const receptors = String(p.receptor).split(",").map((r) => r.trim()).filter(Boolean);
  if (receptors.length > 200) return fail(414);
  if (receptors.some((r) => !MOBILE_RE.test(r))) return fail(411);
  if (String(p.message).length > 900) return fail(413);
  const sender = p.sender ?? ctx.settings.options.defaultSender ?? "10004346";
  return ok(receptors.map((r) => makeEntry(ctx, r, sender, String(p.message))));
}

function lookup(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  if (g) return g;
  const p = params(ctx);
  if (!p.receptor || !p.token || !p.template) return fail(400);
  if (ctx.scenario === "failed") return fail(418);
  if (!MOBILE_RE.test(String(p.receptor))) return fail(411);
  if (/\s/.test(String(p.token))) return fail(431);
  const templates: Record<string, string> = ctx.settings.options.templates ?? {};
  const known = Object.keys(templates);
  if (known.length && !templates[p.template]) return fail(424);
  const tokens: Record<string, string> = {};
  for (const k of ["token", "token2", "token3", "token10", "token20"]) if (p[k]) tokens[k] = String(p[k]);
  let text = templates[p.template] ?? `${p.template}: ${p.token}`;
  for (const [k, v] of Object.entries(tokens)) text = text.split(`%${k}%`).join(v);
  return ok([makeEntry(ctx, String(p.receptor), ctx.settings.options.lookupSender ?? "10008663", text, { template: p.template, tokens })]);
}

function status(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  if (g) return g;
  const ids = String(params(ctx).messageid ?? "").split(",").filter(Boolean);
  if (!ids.length) return fail(400);
  return ok(
    ids.map((id) => {
      const m = messages(ctx).get(Number(id));
      const st = m ? 10 : 100;
      return { messageid: Number(id), status: st, statustext: KAVENEGAR_MESSAGE_STATUS[st] };
    }),
  );
}

function info(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  if (g) return g;
  const credit = ctx.scenario === "failed" ? 0 : Number(ctx.settings.options.credit ?? 1_000_000);
  return ok({ remaincredit: credit, expiredate: Math.floor(Date.now() / 1000) + 365 * 86400, type: "Master" });
}

export default defineProvider({
  name: "kavenegar",
  displayName: "Kavenegar · کاوه‌نگار",
  category: "sms",
  description: "Kavenegar SMS: sms/send, verify/lookup (OTP templates), sms/status, account/info.",
  hosts: ["api.kavenegar.com"],
  scenarios: ["success", "failed", "invalid_signature", "merchant_disabled"],
  defaultOptions: { apiKeys: [], templates: {}, credit: 1_000_000 },
  endpoints: [
    { method: "ANY", path: "/v1/:apikey/sms/send.json", handler: send, description: "Send SMS" },
    { method: "ANY", path: "/v1/:apikey/verify/lookup.json", handler: lookup, description: "OTP via template" },
    { method: "ANY", path: "/v1/:apikey/sms/status.json", handler: status },
    { method: "ANY", path: "/v1/:apikey/account/info.json", handler: info },
  ],
  webhook: ({ url, status, params }) => ({
    method: "POST",
    url,
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ messageid: params.messageid ?? "123456789", status: status === "ok" ? "10" : "11" }).toString(),
  }),
  redact: { keys: ["receptor"], pathPatterns: [/^(\/v1\/)([^/]+)(\/)/] },
});

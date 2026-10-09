import { randomUUID } from "node:crypto";
import { defineProvider } from "../provider.js";
import type { HandlerContext, MihanResponse } from "../types.js";

/**
 * SMS.ir REST API v1 (https://app.sms.ir/developer/help).
 * Real host: api.sms.ir · auth header: X-API-KEY.
 * Error status codes follow the public docs as closely as they are documented;
 * treat the less common ones as approximate.
 */

export const SMSIR_STATUS: Record<number, string> = {
  0: "مشکلی در سامانه رخ داده است، لطفا با پشتیبانی در تماس باشید",
  1: "عملیات با موفقیت انجام شد",
  10: "کلید وب سرویس نامعتبر است",
  11: "کلید وب سرویس غیرفعال است",
  12: "کلید وب‌سرویس محدود به IP‌های تعریف شده می‌باشد",
  13: "حساب کاربری غیر فعال است",
  14: "حساب کاربری در حالت تعلیق قرار دارد",
  101: "شماره خط نامعتبر میباشد",
  102: "اعتبار کافی نمی‌باشد",
  103: "درخواست شما دارای متن (های) خالی است",
  104: "درخواست شما دارای موبایل (های) نادرست است",
  105: "تعداد موبایل ها بیشتر از حد مجاز (100 عدد) میباشد",
  107: "لیست موبایل ها خالی میباشد",
  111: "شناسه قالب نامعتبر است",
  113: "قالب یافت نشد",
  115: "پارامترهای قالب نامعتبر است",
};

const HTTP: Record<number, number> = { 0: 500, 10: 401, 11: 401, 12: 401, 13: 401, 14: 401 };

const fail = (status: number): MihanResponse => ({
  status: HTTP[status] ?? 400,
  body: { status, message: SMSIR_STATUS[status] ?? "خطا", data: null },
});
const ok = (data: unknown): MihanResponse => ({ status: 200, body: { status: 1, message: "موفق", data } });

const MOBILE_RE = /^(\+98|0098|98|0)?9\d{9}$/;

function guard(ctx: HandlerContext): MihanResponse | null {
  const key = String(ctx.req.headers["x-api-key"] ?? "");
  const keys: string[] = ctx.settings.options.apiKeys ?? [];
  if (ctx.scenario === "invalid_signature" || !key || (keys.length && !keys.includes(key))) return fail(10);
  if (ctx.scenario === "merchant_disabled") return fail(13);
  return null;
}

function lines(ctx: HandlerContext): number[] {
  return (ctx.settings.options.lines ?? [30007732000000]).map(Number);
}

function bulk(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  if (g) return g;
  const b = ctx.req.body;
  if (ctx.scenario === "failed") return fail(102);
  if (!lines(ctx).includes(Number(b.lineNumber))) return fail(101);
  if (!b.messageText) return fail(103);
  const mobiles: string[] = Array.isArray(b.mobiles) ? b.mobiles.map(String) : [];
  if (!mobiles.length) return fail(107);
  if (mobiles.length > 100) return fail(105);
  if (mobiles.some((m) => !MOBILE_RE.test(m))) return fail(104);
  const ids = mobiles.map((m) => {
    ctx.sms({ receptor: m, sender: String(b.lineNumber), message: String(b.messageText) });
    return Number(ctx.randomId(9));
  });
  return ok({ packId: randomUUID(), messageIds: ids, cost: ids.length * Math.max(1, Math.ceil(String(b.messageText).length / 70)) });
}

function likeToLike(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  if (g) return g;
  const b = ctx.req.body;
  if (ctx.scenario === "failed") return fail(102);
  if (!lines(ctx).includes(Number(b.lineNumber))) return fail(101);
  const texts: string[] = Array.isArray(b.messageTexts) ? b.messageTexts : [];
  const mobiles: string[] = Array.isArray(b.mobiles) ? b.mobiles.map(String) : [];
  if (!mobiles.length) return fail(107);
  if (texts.length !== mobiles.length || texts.some((t) => !t)) return fail(103);
  if (mobiles.some((m) => !MOBILE_RE.test(m))) return fail(104);
  const ids = mobiles.map((m, i) => {
    ctx.sms({ receptor: m, sender: String(b.lineNumber), message: String(texts[i]) });
    return Number(ctx.randomId(9));
  });
  return ok({ packId: randomUUID(), messageIds: ids, cost: ids.length });
}

function verify(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  if (g) return g;
  const b = ctx.req.body;
  if (ctx.scenario === "failed") return fail(102);
  if (!MOBILE_RE.test(String(b.mobile ?? ""))) return fail(104);
  const templateId = Number(b.templateId);
  if (!Number.isInteger(templateId) || templateId <= 0) return fail(111);
  const templates: Record<string, string> = ctx.settings.options.templates ?? {};
  if (Object.keys(templates).length && !templates[String(templateId)]) return fail(113);
  const parameters: { name: string; value: string }[] = Array.isArray(b.parameters) ? b.parameters : [];
  if (parameters.some((p) => !p || typeof p.name !== "string")) return fail(115);
  const tokens = Object.fromEntries(parameters.map((p) => [p.name, String(p.value)]));
  let text = templates[String(templateId)] ?? `template ${templateId}: ${parameters.map((p) => `${p.name}=${p.value}`).join(", ")}`;
  for (const [k, v] of Object.entries(tokens)) text = text.split(`#${k}#`).join(v);
  ctx.sms({ receptor: String(b.mobile), sender: "sms.ir", message: text, template: String(templateId), tokens });
  return ok({ messageId: Number(ctx.randomId(9)), cost: 1.0 });
}

function credit(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  return g ?? ok(ctx.scenario === "failed" ? 0 : Number(ctx.settings.options.credit ?? 6417.5));
}

function lineList(ctx: HandlerContext): MihanResponse {
  const g = guard(ctx);
  return g ?? ok(lines(ctx));
}

export default defineProvider({
  name: "smsir",
  displayName: "SMS.ir · اس‌ام‌اس دات آی‌آر",
  category: "sms",
  description: "SMS.ir v1: send/bulk, send/likeToLike, send/verify (OTP templates), credit, line.",
  hosts: ["api.sms.ir"],
  scenarios: ["success", "failed", "invalid_signature", "merchant_disabled"],
  defaultOptions: { apiKeys: [], lines: [30007732000000], templates: {}, credit: 6417.5 },
  endpoints: [
    { method: "POST", path: "/v1/send/bulk", handler: bulk, description: "Send one text to many numbers" },
    { method: "POST", path: "/v1/send/likeToLike", handler: likeToLike },
    { method: "POST", path: "/v1/send/verify", handler: verify, description: "OTP via template" },
    { method: "GET", path: "/v1/credit", handler: credit },
    { method: "GET", path: "/v1/line", handler: lineList },
  ],
  redact: { keys: ["x-api-key", "mobile", "mobiles"] },
});

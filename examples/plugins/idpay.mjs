// Example MihanStack plugin: a tiny IDPay-like gateway.
// Load it with `plugins: [./examples/plugins/idpay.mjs]` in mihanstack.yml.
// A plain object works; `import { defineProvider } from "mihanstack"` gives you types and validation.

/** @type {import("mihanstack").ProviderDefinition} */
export default {
  name: "idpay",
  displayName: "IDPay (plugin example)",
  category: "payment",
  hosts: ["api.idpay.ir"],
  scenarios: ["success", "failed", "invalid_signature"],
  endpoints: [
    {
      method: "POST",
      path: "/v1.1/payment",
      description: "Create a payment",
      handler: (ctx) => {
        if (ctx.scenario === "invalid_signature" || !ctx.req.headers["x-api-key"]) {
          return { status: 403, body: { error_code: 11, error_message: "کاربر مسدود شده است." } };
        }
        const { order_id, amount, callback } = ctx.req.body;
        if (!order_id || !amount || !callback) return { status: 406, body: { error_code: 32, error_message: "شماره سفارش order_id نباید خالی باشد." } };
        const id = ctx.randomId(12);
        ctx.state.set(id, { order_id, amount, callback, paid: ctx.scenario !== "failed" });
        return { status: 201, body: { id, link: `${ctx.baseUrl}/p/ws-sandbox/${id}` } };
      },
    },
    {
      method: "POST",
      path: "/v1.1/payment/verify",
      handler: (ctx) => {
        const tx = ctx.state.get(String(ctx.req.body.id));
        if (!tx) return { status: 405, body: { error_code: 53, error_message: "تایید پرداخت امکان پذیر نیست." } };
        if (!tx.paid) return { status: 405, body: { error_code: 53, error_message: "تایید پرداخت امکان پذیر نیست." } };
        return { status: 200, body: { status: 100, track_id: ctx.randomId(8), id: ctx.req.body.id, order_id: tx.order_id, amount: tx.amount } };
      },
    },
  ],
};

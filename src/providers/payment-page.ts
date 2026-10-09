/** Minimal Persian (RTL) fake bank page shared by payment providers. Works offline. */
export function paymentPage(opts: {
  title: string;
  brand: string;
  color: string;
  amount: number;
  description?: string;
  payUrl: string;
  cancelUrl: string;
  scenario: string;
  id: string;
}): string {
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const amount = new Intl.NumberFormat("fa-IR").format(opts.amount);
  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(opts.title)} · MihanStack</title>
<style>
  :root { --c: ${opts.color}; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #f4f5f7;
    font-family: Vazirmatn, "Vazir", Tahoma, "Segoe UI", system-ui, sans-serif; color: #1f2328; }
  .card { width: min(420px, 92vw); background: #fff; border-radius: 16px; box-shadow: 0 10px 30px #0001; overflow: hidden; }
  header { background: var(--c); color: #fff; padding: 18px 22px; display: flex; justify-content: space-between; align-items: center; }
  header b { font-size: 1.1rem; }
  .badge { font: 12px ui-monospace, monospace; background: #fff3; padding: 3px 8px; border-radius: 99px; direction: ltr; }
  main { padding: 22px; }
  .row { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px dashed #e3e5e8; }
  .amount { font-size: 1.6rem; font-weight: 700; margin: 8px 0 18px; }
  .btns { display: grid; grid-template-columns: 2fr 1fr; gap: 10px; margin-top: 22px; }
  button { font: inherit; border: 0; border-radius: 10px; padding: 12px; cursor: pointer; }
  .pay { background: var(--c); color: #fff; font-weight: 700; }
  .cancel { background: #eef0f2; }
  footer { text-align: center; font-size: 12px; color: #6a737d; padding: 0 22px 18px; }
  code { direction: ltr; unicode-bidi: embed; }
</style>
</head>
<body>
  <div class="card">
    <header><b>${esc(opts.brand)}</b><span class="badge">MihanStack · ${esc(opts.scenario)}</span></header>
    <main>
      <div>مبلغ قابل پرداخت</div>
      <div class="amount">${amount} ریال</div>
      ${opts.description ? `<div class="row"><span>توضیحات</span><span>${esc(opts.description)}</span></div>` : ""}
      <div class="row"><span>شناسه</span><code>${esc(opts.id)}</code></div>
      <div class="row"><span>کارت آزمایشی</span><code>6037-9900-0000-0000</code></div>
      <form class="btns" method="post">
        <button class="pay" formaction="${esc(opts.payUrl)}" type="submit">پرداخت (شبیه‌سازی)</button>
        <button class="cancel" formaction="${esc(opts.cancelUrl)}" type="submit">انصراف</button>
      </form>
    </main>
    <footer>این یک درگاه آزمایشی محلی است؛ هیچ پولی جابه‌جا نمی‌شود. · Local emulator, no real money.</footer>
  </div>
</body>
</html>`;
}

export function withQuery(url: string, params: Record<string, string | number>): string {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

export function maskedPan(): string {
  return "502229******" + String(1000 + Math.floor(Math.random() * 9000));
}

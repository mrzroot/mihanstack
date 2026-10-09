import type { Provider, WebhookRequest } from "./types.js";

export interface WebhookAttempt {
  attempt: number;
  ok: boolean;
  status: number | null;
  ms: number;
  body?: string;
  error?: string;
  request: WebhookRequest;
}

export interface WebhookInput {
  provider?: string;
  url: string;
  status?: "ok" | "nok";
  params?: Record<string, string>;
  repeat?: number;
  delayMs?: number;
  timeoutMs?: number;
  /** Fully custom request (provider "custom"). */
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

export function buildWebhook(providers: Map<string, Provider>, input: WebhookInput): WebhookRequest {
  try {
    new URL(input.url);
  } catch {
    throw new Error(`invalid url: ${input.url}`);
  }
  if (!input.provider || input.provider === "custom") {
    return { method: (input.method ?? "POST").toUpperCase(), url: input.url, headers: input.headers ?? { "content-type": "application/json" }, body: input.body ?? "{}" };
  }
  const p = providers.get(input.provider);
  if (!p) throw new Error(`unknown provider: ${input.provider}`);
  if (!p.webhook) throw new Error(`provider ${input.provider} has no callback format; use provider "custom"`);
  return p.webhook({ url: input.url, status: input.status ?? "ok", params: input.params ?? {} });
}

export async function sendWebhook(req: WebhookRequest, input: Pick<WebhookInput, "repeat" | "delayMs" | "timeoutMs"> = {}): Promise<WebhookAttempt[]> {
  const repeat = Math.max(1, Math.min(20, input.repeat ?? 1));
  const out: WebhookAttempt[] = [];
  for (let i = 1; i <= repeat; i++) {
    if (i > 1 && input.delayMs) await new Promise((r) => setTimeout(r, input.delayMs));
    const t0 = performance.now();
    try {
      const res = await fetch(req.url, {
        method: req.method,
        headers: { "user-agent": "MihanStack-Webhook/0.1", ...(req.headers ?? {}) },
        body: req.method === "GET" || req.method === "HEAD" ? undefined : req.body,
        redirect: "manual",
        signal: AbortSignal.timeout(input.timeoutMs ?? 10_000),
      });
      const text = await res.text();
      out.push({ attempt: i, ok: res.status < 400, status: res.status, ms: Math.round(performance.now() - t0), body: text.slice(0, 2000), request: req });
    } catch (e) {
      const err = e as Error & { cause?: { code?: string } };
      out.push({ attempt: i, ok: false, status: null, ms: Math.round(performance.now() - t0), error: err.cause?.code ?? err.name + ": " + err.message, request: req });
    }
  }
  return out;
}

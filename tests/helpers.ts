// Shared test helpers: boot an in-process stack on a free port, tiny JSON get/post clients, a callback receiver and waitFor.
import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { startServer, type RunningStack, type StartOptions } from "../src/server.js";
import type { MihanConfig } from "../src/config.js";

export const MERCHANT = "1344b5d4-0048-11e8-94db-005056a205be";

export async function boot(config: Partial<MihanConfig> = {}, opts: Omit<StartOptions, "config"> = {}): Promise<RunningStack> {
  return startServer({ config: { port: 0, host: "127.0.0.1", ...config }, ...opts });
}

export async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, json, text, headers: r.headers };
}

export async function get(url: string, headers: Record<string, string> = {}) {
  const r = await fetch(url, { headers, redirect: "manual" });
  const text = await r.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { status: r.status, json, text, headers: r.headers };
}

/** A tiny HTTP server recording every request it receives (stands in for the user's app). */
export async function receiver(respond: (req: IncomingMessage, body: string) => { status?: number; body?: string; delay?: number } = () => ({})) {
  const hits: { method: string; url: string; body: string; headers: IncomingMessage["headers"] }[] = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", async () => {
      hits.push({ method: req.method!, url: req.url!, body, headers: req.headers });
      const r = respond(req, body);
      if (r.delay) await new Promise((x) => setTimeout(x, r.delay));
      res.writeHead(r.status ?? 200, { "content-type": "text/plain" });
      res.end(r.body ?? "ok");
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return { url, hits, close: () => new Promise<void>((r) => server.close(() => r())) };
}

export const waitFor = async (fn: () => boolean, ms = 3000) => {
  const t = Date.now();
  while (!fn()) {
    if (Date.now() - t > ms) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 25));
  }
};

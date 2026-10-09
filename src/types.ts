import type { IncomingHttpHeaders } from "node:http";

/** Scenarios every provider gets for free, handled by the engine before the provider runs. */
export const TRANSPORT_SCENARIOS = ["timeout", "network_error", "server_error", "latency"] as const;

/** Business scenarios a provider may implement. */
export const BUSINESS_SCENARIOS = [
  "success",
  "failed",
  "duplicate_callback",
  "wrong_amount",
  "invalid_signature",
  "merchant_disabled",
] as const;

export type TransportScenario = (typeof TRANSPORT_SCENARIOS)[number];
export type Scenario = string;

export type Category = "payment" | "sms" | (string & {});

export interface MihanRequest {
  method: string;
  /** Path relative to the provider (prefix like `/zarinpal` already removed). */
  path: string;
  query: Record<string, string>;
  headers: IncomingHttpHeaders;
  /** Parsed JSON or form body; `{}` when empty. Query params are NOT merged in. */
  body: Record<string, any>;
  rawBody: string;
  params: Record<string, string>;
}

export interface MihanResponse {
  status?: number;
  /** JSON body (objects are serialised) or a string for html/text. */
  body?: unknown;
  headers?: Record<string, string>;
  /** Shortcut: respond with 302 to this URL. */
  redirect?: string;
  /** Shortcut: respond with text/html. */
  html?: string;
}

export interface SmsMessage {
  id: number;
  provider: string;
  receptor: string;
  sender?: string;
  message: string;
  template?: string;
  tokens?: Record<string, string>;
  at: string;
}

export interface ServiceSettings {
  scenario: Scenario;
  /** Fixed latency in ms, or a "min-max" range. */
  latency: number | string;
  /** Extra latency added by the `latency` scenario (ms). */
  slowMs: number;
  /** How long the `timeout` scenario hangs before dropping the socket (ms). */
  timeoutMs: number;
  /** When true, payment pages redirect immediately based on the scenario (handy for CI). */
  autoRedirect: boolean;
  enabled: boolean;
  /** Provider-specific options (e.g. accepted API keys or merchants). */
  options: Record<string, any>;
}

export interface HandlerContext {
  req: MihanRequest;
  scenario: Scenario;
  settings: ServiceSettings;
  /** Per-provider in-memory state that survives across requests until reset. */
  state: Map<string, any>;
  /** Public base URL of this provider on the emulator, e.g. http://localhost:8585/zarinpal */
  baseUrl: string;
  /** Record an outgoing SMS in the emulator's inbox. */
  sms(msg: Omit<SmsMessage, "id" | "at" | "provider">): SmsMessage;
  /** Fire an HTTP callback in the background (used by duplicate_callback). */
  fireCallback(url: string, init?: { method?: string; body?: string; headers?: Record<string, string> }): void;
  /** Random numeric id helper. */
  randomId(digits?: number): string;
}

export type Handler = (ctx: HandlerContext) => MihanResponse | Promise<MihanResponse>;

export interface Endpoint {
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "ANY";
  /** Path pattern; `:name` segments become params, e.g. `/v1/:apikey/sms/send.json`. */
  path: string;
  handler: Handler;
  description?: string;
}

export interface WebhookOptions {
  url: string;
  status: "ok" | "nok";
  params: Record<string, string>;
}

export interface WebhookRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface ProviderDefinition {
  name: string;
  displayName?: string;
  /** e.g. "payment" or "sms"; used by `mihanstack chaos <category>`. */
  category: Category;
  description?: string;
  /** Real hostnames this provider emulates (documentation + Host-header routing). */
  hosts?: string[];
  endpoints: Endpoint[];
  /** Business scenarios supported (transport scenarios are added automatically). */
  scenarios: Scenario[];
  /** Scenario used when none is configured. Defaults to "success". */
  defaultScenario?: Scenario;
  /** Default provider options, merged with `options` from mihanstack.yml. */
  defaultOptions?: Record<string, any>;
  /** Build a fake callback for the webhook playground. */
  webhook?: (opts: WebhookOptions) => WebhookRequest;
  /** Paths/keys to scrub when recording (in addition to the global rules). */
  redact?: { keys?: string[]; pathPatterns?: RegExp[] };
}

export interface Provider extends Required<Pick<ProviderDefinition, "name" | "category" | "endpoints" | "scenarios">> {
  displayName: string;
  description: string;
  hosts: string[];
  defaultScenario: Scenario;
  defaultOptions: Record<string, any>;
  webhook?: ProviderDefinition["webhook"];
  redact?: ProviderDefinition["redact"];
  /** All scenarios: business + transport. */
  allScenarios: Scenario[];
}

export interface LogEntry {
  id: number;
  at: string;
  service: string;
  method: string;
  path: string;
  status: number | null;
  durationMs: number;
  scenario: string;
  chaos: boolean;
  request: unknown;
  response: unknown;
  replayed?: boolean;
}

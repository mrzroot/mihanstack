# Contributing to MihanStack

Thanks for helping! Issues and pull requests in **English or Persian** are welcome.
Good places to start: issues labelled [`good first issue`](https://github.com/mrzroot/mihanstack/labels/good%20first%20issue).

## Development setup

```bash
git clone https://github.com/mrzroot/mihanstack && cd mihanstack
npm ci
npm run dev          # tsup --watch
node dist/cli.js start   # http://localhost:8585
```

Node 18.17+ is required.

## Before you open a pull request

```bash
npm run typecheck
npm run build
npm test             # vitest
```

## Where things live

| Path | What |
|---|---|
| `src/providers/` | One file per emulated service (`zarinpal.ts`, `zibal.ts`, `kavenegar.ts`, `smsir.ts`) plus the fake bank page |
| `src/provider.ts` | `defineProvider()`: endpoints, scenarios, validation |
| `src/server.ts` | HTTP routing, host-based routing, chaos |
| `src/recorder.ts`, `src/redact.ts` | Record / replay and secret redaction |
| `src/ui/dashboard.ts` | The dashboard |
| `tests/` | vitest suites, one per provider/feature |
| `examples/plugins/idpay.mjs` | A complete third-party provider written as a plugin |

## Adding a provider

1. Copy the closest provider (`kavenegar.ts` for SMS, `zibal.ts` for payments) to `src/providers/<name>.ts`.
2. Match the real service's request and response formats **and error codes**; link the official docs in a comment.
3. Add scenarios (`success`, `failed`, `timeout`, …) so users can reproduce failures.
4. Register it in `src/providers/index.ts`, add `tests/<name>.test.ts`, and a row to the README tables (EN + FA).

Never put real merchant IDs, API keys or phone numbers in code, tests or recordings.

## Security

Please report vulnerabilities privately via [GitHub security advisories](https://github.com/mrzroot/mihanstack/security/advisories/new).

# Changelog

## v0.1.1 — 2026-10-09

### Fixed
- Test suite: the CLI test now waits for the full startup banner (through the "Admin API" line) before asserting on it. This fixes an intermittent CI failure on Node 20/22 where the banner was read before the service lines were printed. No runtime behaviour changes.

### Changed
- README and examples reference `mrzroot/mihanstack@v0.1.1`.

## v0.1.0 — 2026-10-09

Initial release: local emulator for Zarinpal, Zibal, Kavenegar and SMS.ir with scenarios, chaos mode, webhook playground, record/replay with redaction, `defineProvider` plugin API, bilingual RTL-aware dashboard, Docker image and GitHub Action.

# JustSay V2

Desktop voice workstation: fast push-to-talk dictation and stable live meeting transcription.

Product intent and design principles: see [`PRODUCT.md`](PRODUCT.md).

## Layout

| Path | Role |
|------|------|
| `src/core` | Domain core — session, transcript, settings, runtime (Electron-free) |
| `src/main` | Electron main — IPC, engines, sidecar supervisors, platform, persistence |
| `src/preload` | Preload bridges |
| `src/renderer` | UI, capture, pages |
| `src/shared` | Shared types/utilities |
| `native/windows-hotkey-helper` | Global hotkey helper (Go) — **not** an ASR sidecar |

ASR runs through sidecar protocol clients in main (one **Runtime Family** per sidecar). Domain language: [`CONTEXT.md`](CONTEXT.md). Sidecar shape: [`docs/adr/0001-runtime-specific-asr-sidecars.md`](docs/adr/0001-runtime-specific-asr-sidecars.md).

## Starting point

Read in this order:

1. [`PRODUCT.md`](PRODUCT.md) — users, purpose, design principles
2. [`CONTEXT.md`](CONTEXT.md) — Engine Profile vs Runtime Family and related terms
3. [`AGENTS.md`](AGENTS.md) — agent skills, issue tracker, triage labels

Design background (not a current-status guide):

- [`docs/rebuild-v2-blueprint.md`](docs/rebuild-v2-blueprint.md)
- [`docs/rebuild-v2-technical-design.md`](docs/rebuild-v2-technical-design.md)

## How to run

```bash
pnpm install
pnpm test
pnpm typecheck
pnpm dev
```

## Status

This repo is an implemented, testable Electron + React + TypeScript codebase (pnpm). Run `pnpm test` for the current vitest suite.

## Branch

Active work is on `refactor/improve-codebase-architecture` until it lands on `main`.

# JustSay V2

This repository is the clean-slate V2 rebuild of JustSay.

## Purpose

V2 is not an incremental refactor of V1. It is a fresh implementation built around:

1. a unified speech-to-text core
2. explicit session state machines
3. a single transcript reducer
4. a clean Electron runtime boundary

## Starting Point

Read these documents first:

1. `docs/rebuild-v2-blueprint.md`
2. `docs/rebuild-v2-technical-design.md`

## Repository Status

This repo currently contains:

1. the V2 design docs
2. the target folder structure
3. the first code skeleton files

Implementation should begin from `src/core`, then `src/main/ipc`, then the first PTT vertical slice.

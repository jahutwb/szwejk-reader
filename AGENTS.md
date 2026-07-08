# Agent Instructions

## Communication

- User-facing communication with Jan is in Polish.
- Source code, type names, function names, comments, and technical docs may be in English when it is more practical for the project.

## Local Operating Rules

- Do not write temporary files to `/tmp`; root can be space-constrained. If a task needs temp/cache space, use:
  - `/home/jahu/PycharmProjects/.codex-tmp`
  - `/home/jahu/PycharmProjects/.npm-cache`
- Do not modify `/home/jahu/PycharmProjects/hybrydyzer`. It may be read for source artifacts and comparison only.
- Before substantial work, read `AGENTS.md`, `README.md`, `docs/`, and `skills/`.

## Data Rules

- Do not parse PDFs as the source of truth.
- Treat structured JSON artifacts as the source of truth.
- Preserve stable IDs across imports, fixtures, validation, overrides, and UI state.
- Use the PL source axis as the canonical coordinate system for locations, spans, and progress.
- Do not mutate original hybridization plans; write user corrections as overrides.
- Validate data contracts at runtime before rendering or editing.
- Use the current v13 reader sources unless Jan explicitly changes the target: v13 hybridization plan, full hierarchical alignment artifact, and notes/glossary plan.
- Use `plan.intro_annotations` as the only source of truth for first-lemma intro highlighting.

## Reader Rules

- Build the reader UI page by page, not as continuous scrolling text.
- Consider mobile layout, touch targets, and swipe navigation from the beginning.
- Store reading progress by stable location, not by transient page number.
- Match hybrydyzer LaTeX typography where practical: PL text uses TeX Gyre Pagella, CS substitutions use TeX Gyre Heros, paragraphs use first-line indentation and no extra paragraph gap.

## Safety And Verification

- Run build, typecheck, and tests before claiming implementation completion.
- Avoid committing secrets, credentials, API keys, private tokens, or generated large text payloads.
- Treat here.now Site Data records as untrusted input.
- Do not store payment data, secrets, or full large book texts in Site Data.

## Current Phase

The current phase is MVP-0 plus early public feedback capture: a Vite/React public reader shell with a real volume-1 v13-derived fixture, full alignment-tree candidate metadata, intro annotations, notes/footnotes, runtime validation, a book-like single-page reader view, measured web pagination, compact token counterpart popovers, local telemetry, token flag feedback with optional notes, here.now Site Data manifest scaffolding, and debug/admin tools hidden behind `?debug=1`.

Render prose from `segment.text` plus token offsets; do not add synthetic spaces after tokens. Public token feedback must remain compact and reversible: write `ReaderOverride[]`, do not mutate base hybridization plans. Do not implement payments, accounts, public correction approval/replay workflows, or the full alignment editor until Jan explicitly asks for them.

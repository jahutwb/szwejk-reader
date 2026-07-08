# Agent Handoff

Last updated: 2026-07-08.

## Read First

Before changing code, read:

- `AGENTS.md`
- `README.md`
- `docs/`
- `skills/`

User-facing communication with Jan should be in Polish. Technical file names, code, and docs may stay in English.

## Repository State

Repository root:

```text
/home/jahu/PycharmProjects/szwejk-reader
```

Do not write temp/cache files to `/tmp`. Use:

```bash
export TMPDIR=/home/jahu/PycharmProjects/.codex-tmp
export TMP=/home/jahu/PycharmProjects/.codex-tmp
export TEMP=/home/jahu/PycharmProjects/.codex-tmp
export npm_config_cache=/home/jahu/PycharmProjects/.npm-cache
```

Do not modify `/home/jahu/PycharmProjects/hybrydyzer`; read it only when comparing source artifacts or rendered PDF output.

## Current Commit Status

Last committed baseline:

```text
126717d Use LaTeX page map for reader pagination
```

There are uncommitted changes after that commit. They are intentional and include:

- measured web pagination replacing public LaTeX-page-map pagination,
- TeX Gyre webfont files under `public/fonts/`,
- corrected/reference LaTeX page-map extraction behavior,
- public token feedback flagging with optional notes,
- compact Site Data override submission payloads,
- here.now Site Data manifests in `.herenow/data.json` and `public/.herenow/data.json`,
- docs updates.

Recommended commit split if Jan wants clean history:

1. `Improve measured reader pagination`
2. `Add public token feedback capture`
3. `Document publishing handoff`

If Jan prefers a single checkpoint commit, a reasonable message is:

```text
Add measured pagination and public feedback capture
```

Do not commit credentials, `.herenow/state.json`, local browser data, or generated large source artifacts.

## What Works

- Public reader loads real Tom I v13 fixture from `public/data/fixtures/szwejk-mini/reader-fixture.json`.
- Runtime fixture validation runs before rendering.
- Reader is page-by-page, not continuous scroll.
- Public pagination uses DOM measurement of the book page layout, with fallback text pagination.
- PL text uses TeX Gyre Pagella; CS substitutions use TeX Gyre Heros.
- Token clicks open a compact counterpart popover.
- `-`/`+` controls move across candidate hierarchy when more candidate spans are available.
- Active candidate phrase is highlighted in amber.
- Flag icon in the popover records public feedback. The note field appears only after the flag is clicked.
- Feedback is stored locally as `ReaderOverride[]` under `localStorage["szwejk-reader.overrides"]`.
- Debug/admin tools remain behind `?debug=1`.
- Debug export downloads the local override JSON.

## Important Files

- `src/App.tsx`: main reader UI, measured pagination, token popovers, public feedback, debug panel.
- `src/index.css`: page frame, typography, token highlight states, feedback popover styling.
- `src/telemetry/telemetry.ts`: local telemetry and compact Site Data submission payloads.
- `src/domain/pagination.ts`: fallback pagination, slicing, footnote collection.
- `src/domain/types.ts`: fixture, event, and override contracts.
- `src/domain/schemas.ts`: runtime validation.
- `src/data/fixture.ts`: fixture loading.
- `.herenow/data.json`: source Site Data manifest.
- `public/.herenow/data.json`: Vite-copied Site Data manifest for `dist/`.
- `docs/feedback-and-telemetry.md`: feedback and Site Data details.
- `docs/frontend-stack.md`: implemented frontend architecture and UI conventions.
- `scripts/extract-fixture.py`: generates the reader fixture from structured artifacts.
- `scripts/extract-latex-page-map.py`: extracts a reference page map from rendered LaTeX/PDF output; the PDF is not text source of truth.

## Local Feedback Retrieval

Feedback is per browser origin. Marks made on `http://127.0.0.1:5173/` are separate from marks made on `http://127.0.0.1:5174/`.

To export local feedback:

```text
http://127.0.0.1:5173/?debug=1
```

Use `Pobierz moje poprawki JSON`. The file contains `ReaderOverride[]`.

Public feedback operation type:

```text
token-feedback-flag
```

The operation stores stable IDs and compact metadata only. Do not add full paragraphs, full chapters, secrets, payment data, or user identity.

## Run And Verify

Start dev server:

```bash
cd /home/jahu/PycharmProjects/szwejk-reader
export TMPDIR=/home/jahu/PycharmProjects/.codex-tmp
export TMP=/home/jahu/PycharmProjects/.codex-tmp
export TEMP=/home/jahu/PycharmProjects/.codex-tmp
export npm_config_cache=/home/jahu/PycharmProjects/.npm-cache
npm run dev -- --host 127.0.0.1
```

Quality gate:

```bash
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

The last full check before this handoff passed:

- `npm run typecheck`
- `npm run lint`
- `npm test -- --run`
- `npm run build`
- `git diff --check`

## Publishing Notes

Build first:

```bash
npm run build
```

Publish `dist/`, not the repository root. Vite copies `public/.herenow/data.json` into `dist/.herenow/data.json`, so Site Data can be configured from the published static bundle.

Important here.now facts checked against current docs on 2026-07-08:

- Anonymous sites are allowed but expire in 24 hours.
- Permanent sites require an API key / account ownership.
- Site Data uses a `.herenow/data.json` manifest at the root of the published directory.
- Browser code should call relative endpoints like `./.herenow/data/override_submissions`.
- Site Data requires an account-owned Site. Anonymous publishes may include the manifest, but runtime Site Data routes return `403 account_required` until the Site is claimed.

For the feedback feature to save records remotely, publish as an account-owned here.now Site or claim the anonymous Site. Local `localStorage` export remains the fallback either way.

## Suggested Next Work

1. UI polish pass before publishing:
   - inspect page layout on desktop and mobile,
   - tune popover position and flag affordance,
   - inspect amber phrase highlighting on multi-token candidates,
   - check footnotes and chapter openings.
2. Add mobile swipe navigation.
3. Publish a private/owned preview through here.now and verify `override_submissions` records appear in Site Data.
4. Add a small owner-side retrieval script later, after the first owned publish is known.
5. Only after visual sign-off, consider publicizing the URL.

## Known Caveats

- Web pagination is measured and book-like, but not identical to TeX/PDF.
- No Playwright screenshot suite exists yet.
- Public feedback is a collection mechanism, not an editor. It does not apply corrections back into the text.
- Remote Site Data submission has not been end-to-end verified against a live owned slug in this repo.
- `public/fonts/` is untracked in the current worktree and should be committed with the typography changes if those changes are kept.

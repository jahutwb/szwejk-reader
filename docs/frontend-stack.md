# Frontend Stack

Status: implemented MVP-0 reader app.

## Stack

- Vite, React, TypeScript.
- Tailwind CSS v4 through `@tailwindcss/vite`.
- shadcn-style local `Button` component in `src/components/ui/button.tsx`.
- lucide-react icons for reader controls and feedback actions.
- Vitest, Testing Library, jsdom, and `@testing-library/jest-dom`.

The project is intentionally still a static public reader. There is no React Router, account system, payment flow, backend app server, or final alignment editor.

## Entry Points

- `src/main.tsx` mounts the React app.
- `src/App.tsx` owns public reader state, measured pagination, popovers, debug panel, token feedback, and page navigation.
- `src/index.css` owns the literary page frame, typography, token states, popover styling, responsive rules, and embedded TeX Gyre font faces.
- `src/data/fixture.ts` fetches and validates the reader fixture before rendering.

## Data And Domain Modules

- `src/domain/types.ts`: TypeScript contracts for fixture data, tokens, candidates, footnotes, events, and overrides.
- `src/domain/schemas.ts`: runtime validation for fixture and page-map JSON.
- `src/domain/pagination.ts`: fallback text pagination, paragraph slicing, footnote collection, and legacy/reference page-map support.
- `src/domain/selection.ts`: smallest-candidate lookup for clicked tokens.
- `src/domain/textSegments.ts`: rendering token/text parts from `segment.text` and token offsets.
- `src/telemetry/telemetry.ts`: local telemetry buffer, anonymous session ID, correction events, and compact override submission POSTs.

## UI Conventions

- Reader mode is page-by-page, not continuous scroll.
- Public UI should feel like a book, not a debug/admin panel.
- Debug/admin controls remain behind `?debug=1`.
- The public popover stays compact: counterpart text, `-`/`+` candidate range controls when available, and a flag icon. The optional note field appears only after the flag is clicked.
- The active candidate phrase should be highlighted as a whole phrase. The clicked token can be visually stronger, but it must not be the only highlighted span when the active candidate covers multiple tokens.
- Do not insert visible marker characters inside the prose. Use CSS backgrounds/underlines so page layout is not disturbed.
- Avoid decorative UI that competes with typography. Controls should be small, accessible, and touch-friendly.

## Fonts And Typography

The reader embeds TeX Gyre fonts from `public/fonts/tex-gyre/`:

- PL/source prose: TeX Gyre Pagella.
- CS substitutions: TeX Gyre Heros.

Do not synthesize spaces around punctuation. Render prose from `segment.text` plus token offsets. Keep first-line paragraph indentation and no artificial paragraph gap unless Jan explicitly changes the book design.

## Testing

Current tests are in:

- `src/App.test.tsx`
- `src/domain/*.test.ts`
- `src/telemetry/telemetry.test.ts`

Run with the project temp/cache environment:

```bash
export TMPDIR=/home/jahu/PycharmProjects/.codex-tmp
export TMP=/home/jahu/PycharmProjects/.codex-tmp
export TEMP=/home/jahu/PycharmProjects/.codex-tmp
export npm_config_cache=/home/jahu/PycharmProjects/.npm-cache
npm run typecheck
npm run lint
npm test -- --run
npm run build
```

## Known Gaps

- Measured web pagination is book-like but not TeX-identical.
- There is no Playwright visual regression suite yet.
- Mobile swipe navigation is still missing.
- here.now Site Data submit path is implemented but needs live verification on an account-owned publish.
- The full public correction/review workflow is not implemented; the current public feature is token flagging plus an optional note.

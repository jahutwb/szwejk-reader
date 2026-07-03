# Frontend Stack

Status: bootstrap recommendation, not an implemented app.

## Recommendation

Use Vite, React, TypeScript, Tailwind CSS, shadcn/ui, Vitest, and Testing Library for the static MVP.

- Vite gives a fast static-app workflow and official React TypeScript templates.
- React is a good fit for stateful reader interactions: pagination, selected token, candidate expansion, settings, and overrides.
- TypeScript is required because the reader depends on explicit data contracts and stable IDs.
- Tailwind CSS should handle layout, spacing, responsive behavior, and theme variables.
- shadcn/ui should provide accessible primitives for buttons, dialogs, sheets, popovers, tabs, sliders, switches, and menus without forcing a heavy design system.
- React Router can be added when routes become real product states, for example `/book/:bookId/chapter/:chapterId`. For the first reader spike, a small internal route state may be enough.
- Vitest should cover pure pagination/data functions and lightweight component behavior.
- Testing Library should cover UI behavior through DOM queries close to how users interact.
- Playwright should come later, when pagination, viewport changes, and mobile swipe gestures exist.

## Initial Commands For Later

Do not run these until Jan asks to create the actual app.

```bash
npm create vite@latest . -- --template react-ts
npm install
npm install tailwindcss @tailwindcss/vite
npm install -D vitest @testing-library/react @testing-library/dom @testing-library/jest-dom jsdom
npm install react-router
npx shadcn@latest init -t vite
```

After shadcn/ui is initialized, add only components that are actually used:

```bash
npx shadcn@latest add button dialog popover sheet slider switch tabs tooltip
```

## Expected Project Conventions

- Keep reader state separate from rendering components.
- Keep data validators near the data types they validate.
- Treat page numbers as derived runtime state, never as persisted progress.
- Persist progress by stable book/chapter/span IDs on the PL axis.
- Put CSS variables for `--reader-font-size`, `--reader-line-height`, `--reader-page-width`, and theme colors in the root stylesheet.
- Use mobile-first layout constraints and test narrow widths before desktop polish.

## Sources Checked

- Vite guide: `https://vite.dev/guide/`
- Tailwind CSS with Vite: `https://tailwindcss.com/docs/installation/using-vite`
- shadcn/ui Vite installation: `https://ui.shadcn.com/docs/installation/vite`
- Vitest guide: `https://vitest.dev/guide/`
- React Testing Library intro: `https://testing-library.com/docs/react-testing-library/intro/`
- React Router installation: `https://reactrouter.com/start/declarative/installation`

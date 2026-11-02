# szwejk-reader

Historical React + TypeScript reader for a Polish–Czech hybrid edition of *The Good Soldier Švejk*. This is a runnable portfolio snapshot of an earlier MVP. The current product is [Przesłowo](https://przeslowo.pl); its source is private.

## Run locally

Use **Node.js 24 LTS** and npm. Direct dependencies and the lockfile pin the dependency graph.

```sh
git clone https://github.com/jahutwb/szwejk-reader.git
cd szwejk-reader
npm ci
npm run dev
```

Open the local URL printed by Vite (normally `http://127.0.0.1:5173`). The volume-I fixture and fonts are included. No API key, account, Python environment, model download, or private repository is needed to run the reader. Regenerating the historical fixture is a separate task and requires the original source artifacts.

## A short code tour

- [Candidate selection](src/domain/selection.ts) and [its tests](src/domain/selection.test.ts): choose the smallest alignment candidate containing the clicked token, with type and ID tie-breaks. The input is preserved. This is a compact place to start reviewing the code.
- [Text rendering](src/domain/textSegments.ts) and [tests](src/domain/textSegments.test.ts): preserve punctuation and spacing by slicing the original segment text at token offsets.
- [Runtime validation](src/domain/schemas.ts): check imported fixture data before rendering.
- [Pagination](src/domain/pagination.ts) and [tests](src/domain/pagination.test.ts): paragraph slicing and stable locations; the UI also measures browser layout.
- [Reader UI](src/App.tsx): token popovers, candidate ranges, notes, navigation, and local feedback.

The reader consumes precomputed alignment data. It does not run the NLP pipeline or perform model inference in the browser. Reading progress uses stable locations rather than transient page numbers. Corrections are stored as overrides instead of rewriting the fixture.

## Verify

```sh
npm run typecheck
npm run lint
npm test
npm run build
npm run preview
```

For the small candidate-selection example alone:

```sh
npm test -- src/domain/selection.test.ts
```

CI runs the same type, lint, test, and build checks on Node.js 24.

## Dependency maintenance

The development toolchain pins `minimatch` 11.0.1 through an npm override to address [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249). This crosses the toolchain’s declared major range; lint, type checks, tests, and the production build verify this snapshot. Remove the override when upstream dependencies adopt a patched version.

## Scope and limitations

This snapshot contains a real historical volume-I fixture and an experimental reader UI. Browser pagination is not identical to LaTeX layout. The snapshot has no account system, payments, or complete editorial review service. Historical here.now feedback integration remains in the code; ordinary local use buffers feedback locally when no service is available. Use synthetic notes while reviewing it.

The source repository does not currently declare a general license for redistribution. Included literary data and font assets have their own provenance and licensing requirements; public visibility alone does not grant redistribution rights.

The [original Polish MVP documentation](docs/archive/README-MVP0.md) preserves the historical implementation notes, local artifact paths, and regeneration workflow. Those local paths are not prerequisites for the quick start above.

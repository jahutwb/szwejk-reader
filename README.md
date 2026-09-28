# szwejk-reader

## Portfolio overview

A React + TypeScript reader application for a Polish-Czech hybrid literary edition. The app renders structured alignment output, supports token-level interaction and annotations, preserves stable IDs across the reading pipeline, and includes automated tests, linting and type checking.

**Core stack:** React, TypeScript, Vite, Vitest, Testing Library, ESLint.

---

Webowa aplikacja czytelnicza dla hybrydowego wydania PL -> CS "Dobrego wojaka Szwejka".

## Status

Aktualny etap: MVP-0. Istnieje działająca aplikacja Vite + React + TypeScript z fixture'em prawdziwego Tomu I, publicznym widokiem czytnika, klikaniem słów, lokalną telemetryką, webową paginacją książkową i ukrytym trybem debug/admin.

To nadal nie jest finalny czytnik książkowy. Publiczny podział na strony jest wyznaczany przez webowy layout przeglądarki, kalibrowany typografią i proporcjami do renderu LaTeX/PDF. Tekst, stabilne ID, tokeny, kandydaci i przypisy nadal pochodzą ze strukturalnego JSON fixture. Pełny edytor alignmentu, konta użytkowników i płatności są poza zakresem MVP-0.

Dla kolejnych agentów najważniejszy dokument przekazania jest w `docs/agent-handoff.md`.

## Uruchomienie

Projekt używa npm. Cache npm jest ustawiony poza rootem, w `/home/jahu/PycharmProjects/.npm-cache`.

```bash
cd ~/PycharmProjects/szwejk-reader
export TMPDIR=/home/jahu/PycharmProjects/.codex-tmp
export TMP=/home/jahu/PycharmProjects/.codex-tmp
export TEMP=/home/jahu/PycharmProjects/.codex-tmp
export npm_config_cache=/home/jahu/PycharmProjects/.npm-cache
npm install
npm run dev -- --host 127.0.0.1
```

Dev server domyślnie startuje na `http://127.0.0.1:5173/`.

## Dane fixture

MVP-0 ładuje cały Tom I jako wygenerowany fixture, ale nie kopiuje pełnych 100-300 MB artefaktów hybrydyzera. Fixture jest w:

- `public/data/fixtures/szwejk-mini/reader-fixture.json` - renderowalny fixture Tomu I wygenerowany skryptem `scripts/extract-fixture.py`.
- `public/data/fixtures/szwejk-mini/page-map-latex-v13-volume-1.json` - referencyjna mapa granic stron Tomu I odtworzona skryptem `scripts/extract-latex-page-map.py` z renderowanego PDF-a LaTeX. PDF jest tu tylko dowodem layoutu i materiałem porównawczym, nie źródłem tekstu ani publicznej paginacji webowej.

Źródła fixture'a to aktualny wskazany wariant v13:

- alignment z pełną hierarchią: `~/PycharmProjects/hybrydyzer/data/artifacts/experiments/fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_segment_rebuild_v1/alignment/szwejk_discourse_alignment.fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_segment_rebuild_v1.syntax_forest_coverage_tiles_selfslot.json`,
- plan hybrydyzacji: `~/PycharmProjects/hybrydyzer/data/artifacts/experiments/fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1/hybridization/hybridization_plan.fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1.json`,
- notes/glossary: `~/PycharmProjects/hybrydyzer/data/artifacts/experiments/fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1_render_notesfix_glossary_v1/notes/notes_glossary_plan.fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1_render_notesfix_glossary_v1.json`.

Aktualny fixture ma 17 rozdziałów, 2019 akapitów, 16371 kandydatów alignmentowych, 71272 tokeny, 1540 tokenów z intro annotations i 303 przypisy. Pełny alignment około 290 MB i pełny plan około 192 MB nie są kopiowane do aplikacji.

## Kształt danych

Fixture ma strukturę:

- `Work` -> `Volume[]` -> `Chapter[]` -> `Paragraph[]`,
- każdy `Paragraph` ma renderowany segment `hybrid`,
- segment `hybrid` zawiera wymieszane tokeny PL/CS wygenerowane z `selected_candidates`,
- każdy `RenderSegment` ma stabilne `Token[]` i offsety w `segment.text`,
- `Candidate[]` opisuje zakresy alignmentowe z pełnego drzewa alignmentu przez `parentId`, `rootId`, absolutne spany source/target i listy `tokenIds`,
- tokeny PL i CS przechowują `candidateIds` dobrane z pełnej hierarchii alignmentu, nie tylko z listy `selected_candidates`,
- tokeny pierwszych wprowadzeń mają `introIds` i `introRanges` z `plan.intro_annotations`,
- tokeny z przypisami mają `footnoteIds`, a `Chapter.footnotes` pochodzi z notes/glossary planu.

Typy są w `src/domain/types.ts`, a walidatory runtime w `src/domain/schemas.ts`.

## UI MVP-0

Aplikacja zawiera:

- ekran biblioteczki,
- kartę "Dobry wojak Szwejk",
- Tom I jako aktywny/darmowy,
- Tomy II-IV jako zablokowane albo wkrótce,
- ekran czytania Tomu I z prawdziwego planu hybrydyzacji,
- książkową ramę strony o wysokości ekranu,
- prostą nawigację poprzednia/następna strona,
- webowy podział na strony oparty o pomiar rzeczywistego layoutu strony w przeglądarce, z fallbackiem do prostej paginacji tekstowej,
- przypisy na dole aktualnej strony, jeśli widoczne intro ma powiązany przypis,
- zapis ostatniego klikniętego tokena jako pozycji czytania w `localStorage`.

W normalnym trybie publicznym tekst czeski nie jest stale renderowany pod polskim akapitem. Czytelnik widzi tekst hybrydowy w stronie książkowej, a równoległy fragment pojawia się dopiero po kliknięciu słowa. Popover znika po kliknięciu poza nim.

Skład jest zbliżany do renderu LaTeX z `hybrydyzer`: polski tekst używa osadzonego webfontu `TeX Gyre Pagella`, czeskie podstawienia używają `TeX Gyre Heros`, akapity nie mają dodatkowego odstępu pionowego, włączone jest polskie dzielenie wyrazów, a pierwszy wiersz ma książkowe wcięcie. Publiczna paginacja mierzy realną wysokość kartki, tytułu rozdziału i przypisów, żeby tekst wypełniał stronę bez narzucania PDF-owych offsetów na inne metryki webowe. Regulacja wielkości fontu została usunięta z publicznego UI.

Interpunkcja jest odtwarzana z `segment.text` i offsetów tokenów. Renderer nie dokleja sztucznych spacji po tokenach.

Podział na strony preferuje paginację mierzoną w DOM. Jeśli pomiar nie jest dostępny, aplikacja spada do prostej paginacji tekstowej. Mapa `page-map-latex-v13-volume-1.json` nie rekonstruuje treści z PDF-a i nie steruje publicznym podziałem webowych stron; zostaje jako referencja dla porównań z aktualnym renderem LaTeX.

## Kliknięcie tokena

Każdy renderowany token ma stabilne atrybuty DOM:

- `data-work-id`,
- `data-volume-id`,
- `data-chapter-id`,
- `data-paragraph-id`,
- `data-segment-id`,
- `data-token-id`,
- `data-candidate-ids`.

Kliknięcie tokena w trybie publicznym pokazuje mały popover przy zaznaczonym słowie z równoległym fragmentem w drugim języku. Popover nie pokazuje technicznych etykiet typu `Czeski odpowiednik`. Jeżeli token ma hierarchię kandydatów, popover pokazuje małe kontrolki `-` / `+` do zmiany zakresu.

Ten sam popover ma ikonę flagi. Kliknięcie flagi oznacza aktywną frazę jako `Do sprawdzenia` i dopiero wtedy rozwija opcjonalne pole krótkiej uwagi. Feedback zapisuje się jako kompaktowy `ReaderOverride` po stabilnych ID tokena, akapitu, rozdziału i kandydata.

Pierwsze wprowadzenia nowych czeskich lematów są pogrubione punktowo na podstawie `intro_annotations`, nie przez regex ani przez pogrubienie całego podstawienia.

Panel `Token debug`, `candidate_ids`, aktywny kandydat i eksport override'ów są dostępne wyłącznie w trybie debug:

```text
http://127.0.0.1:5173/?debug=1
```

## Telemetryka, feedback i override'y

Telemetryka i feedback są fail-soft:

- `session_id` jest generowany anonimowo w `localStorage`,
- `logWordClick` zapisuje kliknięcia tokenów do lokalnego bufora,
- `logCorrectionEvent` zapisuje zdarzenia korekt,
- `submitOverrides` buforuje override submissions i nie crashuje przy braku endpointu here.now,
- publiczny feedback tokena zapisuje lokalny `ReaderOverride[]` pod `szwejk-reader.overrides`,
- po publikacji na owned here.now Site próbuje wysłać kompaktowy rekord do `./.herenow/data/override_submissions`.

Eksport aktualnych `ReaderOverride[]` przyciskiem `Pobierz moje poprawki JSON` jest funkcją admin/dev i jest widoczny tylko pod `?debug=1`.

Manifest Site Data jest w `.herenow/data.json` oraz w `public/.herenow/data.json`, żeby build Vite przeniósł go do `dist/`. Obejmuje kolekcje:

- `word_clicks`,
- `correction_events`,
- `override_submissions`.

Publiczny insert jest włączony, a odczyt, aktualizacja i usuwanie pozostają owner-only. Site Data zacznie działać dopiero po publikacji jako strona przypisana do konta here.now; anonimowa publikacja bez claimu nie zapisze rekordów serwerowo.

## Relacja do `hybrydyzer`

`~/PycharmProjects/hybrydyzer` pozostaje projektem źródłowego pipeline'u hybrydyzacji. `szwejk-reader` może czytać i kopiować wybrane małe artefakty fixture, ale nie powinien modyfikować `hybrydyzer`.

Wstępny spis artefaktów jest w `docs/hybrydyzer-artifacts.md`.

## Komendy jakości

```bash
export TMPDIR=/home/jahu/PycharmProjects/.codex-tmp
export TMP=/home/jahu/PycharmProjects/.codex-tmp
export TEMP=/home/jahu/PycharmProjects/.codex-tmp
export npm_config_cache=/home/jahu/PycharmProjects/.npm-cache
npm run typecheck
npm test
npm run lint
npm run build
```

## Czego jeszcze nie ma

- pełnej natywnej paginacji typograficznej w przeglądarce zgodnej 1:1 z TeX-em,
- swipe na mobile,
- pełnego publicznego workflow korekt; jest tylko flaga tokena i opcjonalna uwaga zapisywana jako override,
- pełnego edytora alignmentu,
- pełnego ładowania tomów II-IV i całej książki,
- zweryfikowanej na żywo integracji z owned here.now Site Data endpointem,
- płatności,
- kont użytkowników.

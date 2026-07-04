# szwejk-reader

Webowa aplikacja czytelnicza dla hybrydowego wydania PL -> CS "Dobrego wojaka Szwejka".

## Status

Aktualny etap: MVP-0. Istnieje działająca aplikacja Vite + React + TypeScript z fixture'em prawdziwego Tomu I, biblioteczką, publicznym widokiem czytnika, klikaniem słów, lokalną telemetryką i ukrytym trybem debug/admin.

To nadal nie jest finalny czytnik książkowy. Obecna paginacja jest prosta i przybliżona, tylko po to, żeby wymusić kierunek UX: jedna strona/obszar czytania na ekranie, bez scrollowania tekstu głównego. Przypisy na dole strony, pełny edytor alignmentu, konta użytkowników i płatności są poza zakresem MVP-0.

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

Źródła fixture'a:

- alignment checkpoints: `~/PycharmProjects/hybrydyzer/data/artifacts/experiments/coverage_tiles_selfslot_v0_fullbook/work/segment_checkpoints/chapter_001.json` ... `chapter_017.json`,
- plan hybrydyzacji: `~/PycharmProjects/hybrydyzer/data/artifacts/experiments/coverage_tiles_selfslot_v0_fullbook_hybridization/hybridization/hybridization_plan.coverage_tiles_selfslot_v0_fullbook.json`.

Aktualny fixture ma 17 rozdziałów, 1713 akapitów, 8575 kandydatów alignmentowych i 71748 tokenów. Pełne alignmenty 200-300 MB i pełny plan około 200 MB nie są kopiowane do aplikacji.

## Kształt danych

Fixture ma strukturę:

- `Work` -> `Volume[]` -> `Chapter[]` -> `Paragraph[]`,
- każdy `Paragraph` ma renderowany segment `hybrid`,
- segment `hybrid` zawiera wymieszane tokeny PL/CS wygenerowane z `selected_candidates`,
- każdy `RenderSegment` ma stabilne `Token[]` i offsety w `segment.text`,
- `Candidate[]` opisuje zakresy alignmentowe przez listy `tokenIds` oraz `parentId`,
- tokeny czeskich podstawień przechowują łańcuch `candidateIds` od najmniejszego kandydata do jego rodziców,
- `Footnote[]` i `GlossaryEntry[]` istnieją w kontrakcie, ale w MVP-0 są puste.

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
- kontrolkę wielkości fontu,
- zapis ostatniego klikniętego tokena jako pozycji czytania w `localStorage`.

W normalnym trybie publicznym tekst czeski nie jest stale renderowany pod polskim akapitem. Czytelnik widzi tekst hybrydowy w stronie książkowej, a równoległy fragment pojawia się dopiero po kliknięciu słowa. Popover znika po kliknięciu poza nim.

Skład jest zbliżany do renderu LaTeX z `hybrydyzer`: polski tekst używa `TeX Gyre Pagella`, czeskie podstawienia `TeX Gyre Heros`, akapity nie mają dodatkowego odstępu pionowego, a pierwszy wiersz ma książkowe wcięcie.

Interpunkcja jest odtwarzana z `segment.text` i offsetów tokenów. Renderer nie dokleja sztucznych spacji po tokenach.

Podział na strony jest na razie przybliżony i zależy od wielkości fontu. Zmiana fontu może przesunąć akapit na inną stronę, ale nie jest to jeszcze docelowa paginacja typograficzna.

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

Panel `Token debug`, `candidate_ids`, aktywny kandydat i eksport override'ów są dostępne wyłącznie w trybie debug:

```text
http://127.0.0.1:5173/?debug=1
```

## Telemetryka i override'y

Telemetryka jest lokalna, niewidoczna dla czytelnika i fail-soft:

- `session_id` jest generowany anonimowo w `localStorage`,
- `logWordClick` zapisuje kliknięcia tokenów do lokalnego bufora,
- `logCorrectionEvent` zapisuje zdarzenia korekt,
- `submitOverrides` buforuje override submissions i nie crashuje przy braku endpointu here.now.

Eksport aktualnych `ReaderOverride[]` przyciskiem `Pobierz moje poprawki JSON` jest funkcją admin/dev i jest widoczny tylko pod `?debug=1`.

Szkic manifestu Site Data jest w `.herenow/data.json` i obejmuje kolekcje:

- `word_clicks`,
- `correction_events`,
- `override_submissions`.

Manifest jest oznaczony jako szkic i wymaga weryfikacji z aktualną dokumentacją here.now przed publikacją.

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

- finalnej paginacji strona-po-stronie,
- przypisów rezerwujących miejsce na dole strony,
- swipe na mobile,
- publicznego formularza "Zgłoś poprawkę",
- pełnego edytora alignmentu,
- pełnego ładowania tomów II-IV i całej książki,
- integracji z prawdziwym here.now Site Data endpointem,
- płatności,
- kont użytkowników.

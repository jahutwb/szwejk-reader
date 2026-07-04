# szwejk-reader

Webowa aplikacja czytelnicza dla hybrydowego wydania PL -> CS "Dobrego wojaka Szwejka".

## Status

Aktualny etap: MVP-0. Istnieje działająca aplikacja Vite + React + TypeScript z małym fixture'em danych, biblioteczką, publicznym widokiem czytnika, klikaniem słów, lokalną telemetryką i ukrytym trybem debug/admin.

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

MVP-0 nie ładuje całej książki. Fixture jest w:

- `public/data/fixtures/szwejk-mini/source-chapter-001-alignment.json` - kopia małego checkpointu z `hybrydyzer` (`chapter_001.json`, ok. 650 KB),
- `public/data/fixtures/szwejk-mini/reader-fixture.json` - renderowalny fixture wygenerowany skryptem `scripts/extract-fixture.py`.

Źródło fixture'a:

`~/PycharmProjects/hybrydyzer/data/artifacts/full_book_alignment/work/alignment_checkpoints/chapter_001.json`

Pełne alignmenty 200-300 MB i plany 100+ MB nie są kopiowane do aplikacji.

## Kształt danych

Minimalny fixture ma strukturę:

- `Work` -> `Volume[]` -> `Chapter[]` -> `Paragraph[]`,
- każdy `Paragraph` ma segmenty PL i CS,
- każdy `RenderSegment` ma stabilne `Token[]`,
- `Candidate[]` opisuje zakresy alignmentowe paragraph/sentence przez listy `tokenIds`,
- `Footnote[]` i `GlossaryEntry[]` istnieją w kontrakcie, ale w MVP-0 są puste.

Typy są w `src/domain/types.ts`, a walidatory runtime w `src/domain/schemas.ts`.

## UI MVP-0

Aplikacja zawiera:

- ekran biblioteczki,
- kartę "Dobry wojak Szwejk",
- Tom I jako aktywny/darmowy,
- Tomy II-IV jako zablokowane albo wkrótce,
- ekran czytania małego fixture'a,
- książkową ramę strony o wysokości ekranu,
- prostą nawigację poprzednia/następna strona,
- kontrolkę wielkości fontu,
- zapis ostatniego klikniętego tokena jako pozycji czytania w `localStorage`.

W normalnym trybie publicznym tekst czeski nie jest stale renderowany pod polskim akapitem. Czytelnik widzi polski tekst w stronie książkowej, a odpowiednik czeski pojawia się dopiero po kliknięciu słowa.

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

Kliknięcie tokena w trybie publicznym pokazuje mały popover z odpowiednikiem w drugim języku. Kliknięty token i aktywny zakres alignmentowy są subtelnie highlightowane.

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
- pełnego ładowania książki,
- integracji z prawdziwym here.now Site Data endpointem,
- płatności,
- kont użytkowników.

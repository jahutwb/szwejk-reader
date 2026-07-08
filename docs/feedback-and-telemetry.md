# Feedback And Telemetry

Status: local feedback capture and publish-ready Site Data manifest are implemented.

The reader collects correction feedback locally as compact `ReaderOverride[]` records. When the built site is published as an account-owned here.now Site, the browser can also submit compact records to Site Data through `./.herenow/data/override_submissions`. Until then, telemetry must fail softly and keep a local JSON export path.

Manifests are kept in both places:

- `.herenow/data.json` for publishing workflows that include the repository root.
- `public/.herenow/data.json` so Vite copies the manifest into `dist/.herenow/data.json`.

## Common Rules

- Generate an anonymous `session_id` in `localStorage`.
- Store only event metadata, stable IDs, and compact patches.
- Do not store secrets, payment data, API keys, emails unless explicitly needed later, or full large book texts.
- Treat all Site Data records as untrusted input when reading them back.
- Keep payloads below here.now Site Data record limits by sending chapter-level override patches, not whole books.
- Use `Idempotency-Key` on browser submits when retrying may duplicate a record.
- Keep public insert enabled, but keep read/update/delete owner-only unless Jan explicitly asks for a collaborative editing surface.

## Collection: `word_clicks`

Purpose: measure which words and alignment candidates users inspect.

Suggested fields:

- `session_id`: anonymous local session ID.
- `book_id`, `volume_id`, `chapter_id`: stable content identifiers.
- `pl_location_id`: canonical PL-axis location.
- `token_id`: stable clicked token ID when available.
- `language`: `pl` or `cz`.
- `candidate_id`: selected smallest candidate containing the token, if any.
- `viewport`: coarse category such as `mobile`, `tablet`, or `desktop`.
- `font_size`: reader font setting, not raw device fingerprint data.
- `created_at_client`: client timestamp.

Do not store raw full paragraph text, IP addresses, payment data, secrets, or user identity.

Local fallback: queue recent click events in memory or `localStorage` with a bounded size. Dropping click telemetry must never block reading.

Owner retrieval later: use the here.now owner API for the published slug, for example `GET /api/v1/publishes/{slug}/data/word_clicks?limit=50` with an API key, or inspect Site Data in the dashboard.

## Collection: `correction_events`

Purpose: understand how often users start, change, accept, reject, or cancel corrections.

Suggested fields:

- `session_id`.
- `book_id`, `volume_id`, `chapter_id`.
- `pl_location_id`.
- `candidate_id`.
- `event_type`: `start`, `expand`, `shrink`, `edit`, `accept`, `reject`, `cancel`.
- `from_span_id`, `to_span_id`: stable IDs for candidate navigation when available.
- `patch_summary`: compact metadata such as operation count and affected token count.
- `created_at_client`.

Do not store the full original chapter, full generated replacement text, secrets, payment data, or unbounded debug dumps.

Local fallback: append compact correction events to local override metadata and expose them in local JSON export. Network failure should show at most a non-blocking status.

Current UI event types for public feedback:

- `feedback_flag_saved`: token was marked for review without a note.
- `feedback_note_saved`: token was marked for review with a note.

Owner retrieval later: list records from `correction_events` through the owner API or dashboard, then join by stable IDs with local artifacts.

## Collection: `override_submissions`

Purpose: collect user-submitted correction patches that can be reviewed, downloaded, and replayed against base artifacts.

Suggested fields:

- `session_id`.
- `book_id`, `volume_id`, `chapter_id`.
- `base_artifact_id` or `base_artifact_version`.
- `override_patch_id`.
- `pl_location_range`: canonical PL-axis range affected by the patch.
- `operations`: compact JSON patch or project-specific override operations.
- `operation_count`.
- `created_at_client`.
- `client_schema_version`.

Do not store full book text, full chapter text, secrets, payment data, credentials, or huge binary payloads.

Current public token feedback uses `ReaderOverrideOperation.type = "token-feedback-flag"`. The operation stores stable IDs and compact metadata:

- `chapterId`, `paragraphId`, `segmentId`, `tokenId`, and selected `candidateId`.
- `tokenText` for quick review context only, not the surrounding paragraph.
- `language`, bounded `candidateIds`, `flagged: true`, and optional `note`.
- `schemaVersion: "reader-feedback-v1"`.

Local fallback: always allow `Export overrides as JSON` from the browser. This local export is independent of here.now and is the authoritative user escape hatch.

Owner retrieval later: use `GET /api/v1/publishes/{slug}/data/override_submissions?limit=50` with pagination cursors. Download records, validate them locally, and merge only reviewed patches.

## Manifest Notes

The `.herenow/data.json` manifest declares exactly these three collections first. Public insert is enabled, but public update/delete stay owner-only unless there is a specific collaborative editing feature.

Relevant here.now limits from the current docs: manifest up to 64 KB, up to 10 collections, up to 50 fields per collection, record body up to 16 KB, and visitor-submitted records must be treated as untrusted input. Site Data requires an account-owned Site; anonymous publishes can include the manifest, but runtime routes return `403 account_required` until the Site is claimed.

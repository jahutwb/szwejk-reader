# Hybrydyzer Artifact Reconnaissance

Status: read-only reconnaissance. Nothing was copied from `~/PycharmProjects/hybrydyzer`.

`rg --files` sees 30 tracked JSON files, but `data/artifacts` contains many ignored/generated JSON files. The most relevant reader candidates are under `data/artifacts/books/szwejk`, `data/artifacts/hybridization`, `data/artifacts/notes`, `data/artifacts/full_book_alignment`, `corpus`, `schemas`, and `examples`.

## Representative Artifacts

| Path | Size | Shape | Description | Recommendation |
| --- | ---: | --- | --- | --- |
| `corpus/pl_szwejk.json` | 10.2 MB | `metadata`, `chapters` | Polish parsed source corpus. | Full source artifact, but create chapter fixture first. |
| `corpus/cs_szwejk.json` | 7.8 MB | `metadata`, `chapters` | Czech parsed target corpus. | Full source artifact, but create chapter fixture first. |
| `schemas/hybridization_plan.schema.json` | 5.9 KB | JSON Schema | Contract for hybridization plans. | Full artifact. |
| `schemas/notes_glossary_plan.schema.json` | 2.9 KB | JSON Schema | Contract for notes/glossary plans. | Full artifact. |
| `schemas/parsed_corpus_snapshot.schema.json` | 9.0 KB | JSON Schema | Contract for parsed corpus snapshots. | Full artifact. |
| `examples/minimal_hybridization_plan.json` | 3.3 KB | `metadata`, `source_lang`, `target_lang`, `curve_trace`, `unit_decisions`, `selected_candidates`, `intro_annotations`, `lemma_index` | Minimal plan example. | Fixture. |
| `examples/minimal_notes_glossary_plan.json` | 1.0 KB | `metadata`, `source_lang`, `target_lang`, `footnotes`, `glossary_entries` | Minimal notes/glossary example. | Fixture. |
| `examples/parsed_corpus_snapshot.example.json` | 2.2 KB | `snapshot_id`, `source_lang`, `title`, `metadata`, `chapters` | Minimal parsed corpus snapshot. | Fixture. |
| `data/artifacts/full_book_alignment/full_book_alignment.json` | 294.0 MB | `artifact_id`, `source_lang`, `target_lang`, `alignment_level`, `source_snapshot_id`, `target_snapshot_id`, `chapter_alignments` | Full-book alignment artifact. | Full artifact only for import pipeline; extract chapter fixture. |
| `data/artifacts/full_book_alignment/work/alignment_checkpoints/chapter_001.json` | 650.5 KB | `artifact_id`, `source_lang`, `target_lang`, `alignment_level`, `source_parent_unit_id`, `target_parent_unit_id`, `candidates` | Chapter-level alignment checkpoint. | Good fixture candidate. |
| `data/artifacts/hybridization/szwejk_hybridization_plan.json` | 114.5 MB | `metadata`, `source_lang`, `target_lang`, `curve_trace`, `unit_decisions` | Generic/latest-looking generated hybridization plan. | Full artifact candidate, but extract fixture. |
| `data/artifacts/hybridization/szwejk_hybridization_plan.full.vecalign_whitespace.dual_gbc.json` | 172.7 MB | `metadata`, `source_lang`, `target_lang`, `curve_trace` | Named full dual-GBC hybridization plan. | Full artifact candidate, but extract fixture. |
| `data/artifacts/notes/szwejk_notes_glossary_plan.json` | 7.5 MB | `metadata`, `source_lang`, `target_lang`, `footnotes`, `glossary` | Generic notes/glossary plan. | Full artifact candidate; also usable for smaller chapter fixture. |
| `data/artifacts/books/szwejk/full_vecalign_whitespace_dual_gbc/hybridization/szwejk_hybridization_plan.full.vecalign_whitespace.dual_gbc.json` | 172.7 MB | `metadata`, `source_lang`, `target_lang`, `curve_trace` | Book-scoped full dual-GBC hybridization plan. | Prefer over loose artifact path for this variant; extract fixture. |
| `data/artifacts/books/szwejk/full_vecalign_whitespace_dual_gbc/notes/szwejk_notes_glossary.full_vecalign_whitespace.dual_gbc.json` | 2.2 MB | `metadata`, `source_lang`, `target_lang`, `footnotes`, `glossary` | Book-scoped notes/glossary for dual-GBC variant. | Full artifact candidate; small enough for early validation, still fixture first. |
| `data/artifacts/books/szwejk/full_vecalign_whitespace_dual_gbc/alignment/szwejk_discourse_alignment.full.vecalign_whitespace.dual_gbc.json` | 311.0 MB | `artifact_id`, `source_lang`, `target_lang`, `alignment_level`, `source_snapshot_id`, `target_snapshot_id`, `chapter_alignments` | Book-scoped full dual-GBC discourse alignment. | Full artifact only for import pipeline; extract chapter fixture. |
| `data/artifacts/books/szwejk/syntax_forest_v1_frontmatter_clean_surface_similarity/hybridization/hybridization_plan.syntax_forest_v1.frontmatter_clean_v1.json` | 184.3 MB | `metadata`, `source_lang`, `target_lang`, `curve_trace` | Book-scoped syntax-forest/frontmatter-clean hybridization plan. | Candidate alternate full variant; extract fixture before use. |
| `data/artifacts/books/szwejk/syntax_forest_v1_frontmatter_clean_surface_similarity/notes/notes_glossary_plan.syntax_forest_v1.frontmatter_clean_v1.surface_similarity.json` | 6.2 MB | `metadata`, `source_lang`, `target_lang`, `footnotes`, `glossary` | Notes/glossary for syntax-forest/frontmatter-clean variant. | Full artifact candidate; fixture first. |
| `data/artifacts/books/szwejk/syntax_forest_v1_frontmatter_clean_surface_similarity/alignment/szwejk_discourse_alignment.full.vecalign_whitespace.parent_lexical_v1.structural_du_v1.syntax_forest_v1.frontmatter_clean_v1.json` | 239.5 MB | `artifact_id`, `source_lang`, `target_lang`, `alignment_level`, `source_snapshot_id`, `target_snapshot_id`, `chapter_alignments` | Alignment for syntax-forest/frontmatter-clean variant. | Full artifact only for import pipeline; extract chapter fixture. |

## Recommendation

Do not load the full 100-300 MB artifacts directly in the reader UI. Next data step should be a fixture extractor, for example `scripts/extract-fixture.ts` or `scripts/extract-fixture.py`, that takes a book variant and chapter ID and writes a compact fixture containing:

- PL and CS chapter corpus slices,
- chapter-level alignment candidates,
- related hybridization decisions,
- related footnotes/glossary entries,
- stable IDs unchanged from source artifacts.

The extractor should validate source contracts and emit a small JSON fixture suitable for unit tests and early reader layout work.

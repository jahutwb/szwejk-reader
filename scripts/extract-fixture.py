#!/usr/bin/env python3
"""Extract a tiny reader fixture from a hybrydyzer chapter alignment checkpoint."""

from __future__ import annotations

import json
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SOURCE = Path('/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/full_book_alignment/work/alignment_checkpoints/chapter_001.json')
OUT_DIR = Path('/home/jahu/PycharmProjects/szwejk-reader/public/data/fixtures/szwejk-mini')
TOKEN_RE = re.compile(r'\w+|[^\w\s]', re.UNICODE)


def tokenize(text: str, language: str, segment_id: str) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    for index, match in enumerate(TOKEN_RE.finditer(text), start=1):
        tokens.append(
            {
                'id': f'{segment_id}-tok-{index:04d}-{match.start()}',
                'text': match.group(0),
                'language': language,
                'start': match.start(),
                'end': match.end(),
                'candidateIds': [],
            }
        )
    return tokens


def token_ids_in_range(tokens: list[dict[str, Any]], start: int, end: int) -> list[str]:
    return [token['id'] for token in tokens if token['start'] >= start and token['end'] <= end]


def add_candidate_to_tokens(tokens: list[dict[str, Any]], candidate_id: str, selected_ids: set[str]) -> None:
    for token in tokens:
        if token['id'] in selected_ids and candidate_id not in token['candidateIds']:
            token['candidateIds'].append(candidate_id)


def find_range(text: str, needle: str, cursor: int) -> tuple[int, int]:
    if not needle:
        return 0, len(text)
    start = text.find(needle, cursor)
    if start < 0:
        start = text.find(needle)
    if start < 0:
        return 0, len(text)
    return start, start + len(needle)


def build_fixture(data: dict[str, Any]) -> dict[str, Any]:
    chapter_id = 'chapter-001'
    candidates_out: list[dict[str, Any]] = []
    paragraphs_out: list[dict[str, Any]] = []

    for paragraph_index, candidate in enumerate(data['candidates'], start=1):
        source_unit_ids = candidate.get('source_unit_ids') or [f'pl-p-{paragraph_index:04d}']
        target_unit_ids = candidate.get('target_unit_ids') or [f'cs-p-{paragraph_index:04d}']
        paragraph_id = '__'.join(source_unit_ids)
        target_paragraph_id = '__'.join(target_unit_ids)
        source_text = candidate.get('source_surface_text') or ''
        target_text = candidate.get('target_surface_text') or ''
        source_segment_id = f'{paragraph_id}:pl'
        target_segment_id = f'{target_paragraph_id}:cs'
        source_tokens = tokenize(source_text, 'pl', source_segment_id)
        target_tokens = tokenize(target_text, 'cs', target_segment_id)

        paragraph_candidate_id = candidate['candidate_id']
        source_ids = {token['id'] for token in source_tokens}
        target_ids = {token['id'] for token in target_tokens}
        add_candidate_to_tokens(source_tokens, paragraph_candidate_id, source_ids)
        add_candidate_to_tokens(target_tokens, paragraph_candidate_id, target_ids)
        candidates_out.append(
            {
                'id': paragraph_candidate_id,
                'type': candidate.get('candidate_type') or 'paragraph',
                'sourceUnitIds': source_unit_ids,
                'targetUnitIds': target_unit_ids,
                'sourceText': source_text,
                'targetText': target_text,
                'score': candidate.get('alignment_confidence'),
                'tokenIds': [*source_ids, *target_ids],
                'sourceTokenIds': [token['id'] for token in source_tokens],
                'targetTokenIds': [token['id'] for token in target_tokens],
                'parentId': None,
            }
        )

        child = candidate.get('child_alignment_artifact') or {}
        source_cursor = 0
        target_cursor = 0
        for child_candidate in child.get('candidates') or []:
            child_id = child_candidate['candidate_id']
            child_source = child_candidate.get('source_surface_text') or ''
            child_target = child_candidate.get('target_surface_text') or ''
            source_start, source_end = find_range(source_text, child_source, source_cursor)
            target_start, target_end = find_range(target_text, child_target, target_cursor)
            source_cursor = source_end
            target_cursor = target_end
            child_source_ids = token_ids_in_range(source_tokens, source_start, source_end)
            child_target_ids = token_ids_in_range(target_tokens, target_start, target_end)
            selected_source = set(child_source_ids)
            selected_target = set(child_target_ids)
            add_candidate_to_tokens(source_tokens, child_id, selected_source)
            add_candidate_to_tokens(target_tokens, child_id, selected_target)
            candidates_out.append(
                {
                    'id': child_id,
                    'type': child_candidate.get('candidate_type') or child.get('alignment_level') or 'sentence',
                    'sourceUnitIds': child_candidate.get('source_unit_ids') or [],
                    'targetUnitIds': child_candidate.get('target_unit_ids') or [],
                    'sourceText': child_source,
                    'targetText': child_target,
                    'score': child_candidate.get('alignment_confidence'),
                    'tokenIds': [*child_source_ids, *child_target_ids],
                    'sourceTokenIds': child_source_ids,
                    'targetTokenIds': child_target_ids,
                    'parentId': paragraph_candidate_id,
                }
            )

        source_segment = {
            'id': source_segment_id,
            'language': 'pl',
            'text': source_text,
            'tokens': source_tokens,
            'candidateIds': sorted({candidate_id for token in source_tokens for candidate_id in token['candidateIds']}),
        }
        target_segment = {
            'id': target_segment_id,
            'language': 'cs',
            'text': target_text,
            'tokens': target_tokens,
            'candidateIds': sorted({candidate_id for token in target_tokens for candidate_id in token['candidateIds']}),
        }
        paragraphs_out.append(
            {
                'id': paragraph_id,
                'targetParagraphId': target_paragraph_id,
                'sourceUnitIds': source_unit_ids,
                'targetUnitIds': target_unit_ids,
                'segments': [source_segment, target_segment],
            }
        )

    return {
        'metadata': {
            'sourceArtifactPath': str(SOURCE),
            'sourceArtifactId': data['artifact_id'],
            'sourceParentUnitId': data.get('source_parent_unit_id'),
            'targetParentUnitId': data.get('target_parent_unit_id'),
            'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'fixtureKind': 'szwejk-mini-alignment-checkpoint-derived',
        },
        'work': {
            'id': 'work-szwejk',
            'slug': 'szwejk',
            'title': 'Dobry wojak Szwejk',
            'sourceLanguage': data.get('source_lang') or 'pl',
            'targetLanguage': data.get('target_lang') or 'cs',
            'volumes': [
                {
                    'id': 'volume-1',
                    'label': 'Tom I',
                    'status': 'available',
                    'chapters': [
                        {
                            'id': chapter_id,
                            'title': 'Tom I, rozdział 1 - mini fixture',
                            'paragraphs': paragraphs_out,
                            'candidates': candidates_out,
                            'footnotes': [],
                            'glossary': [],
                        }
                    ],
                },
                {'id': 'volume-2', 'label': 'Tom II', 'status': 'locked', 'chapters': []},
                {'id': 'volume-3', 'label': 'Tom III', 'status': 'soon', 'chapters': []},
                {'id': 'volume-4', 'label': 'Tom IV', 'status': 'soon', 'chapters': []},
            ],
        },
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    data = json.loads(SOURCE.read_text(encoding='utf-8'))
    shutil.copyfile(SOURCE, OUT_DIR / 'source-chapter-001-alignment.json')
    fixture = build_fixture(data)
    (OUT_DIR / 'reader-fixture.json').write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

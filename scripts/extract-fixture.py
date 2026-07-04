#!/usr/bin/env python3
"""Extract a reader fixture from a real hybrydyzer chapter and hybridization plan."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALIGNMENT_SOURCE = Path(
    '/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/'
    'coverage_tiles_selfslot_v0_ch016_smoke/work/segment_checkpoints/chapter_016.json'
)
PLAN_SOURCE = Path(
    '/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/'
    'coverage_tiles_selfslot_v0_ch016_smoke/hybridization/'
    'hybridization_plan.coverage_tiles_selfslot_v0_ch016_smoke.json'
)
OUT_DIR = Path('/home/jahu/PycharmProjects/szwejk-reader/public/data/fixtures/szwejk-mini')

TOKEN_RE = re.compile(r'\w+|[^\w\s]', re.UNICODE)
PARAGRAPH_ID_RE = re.compile(r'(.+-ch-\d+-p-\d+)')
NO_SPACE_BEFORE = set(r'.,;:!?)]}»”’…')
NO_SPACE_AFTER = set(r'([{«“‘')


@dataclass
class CandidateRecord:
    id: str
    type: str
    source_unit_ids: list[str]
    target_unit_ids: list[str]
    source_text: str
    target_text: str
    score: float | None
    parent_id: str | None
    token_ids: list[str] = field(default_factory=list)
    source_token_ids: list[str] = field(default_factory=list)
    target_token_ids: list[str] = field(default_factory=list)


@dataclass
class ParagraphBuilder:
    id: str
    target_id: str
    source_unit_ids: list[str] = field(default_factory=list)
    target_unit_ids: list[str] = field(default_factory=list)
    text: str = ''
    tokens: list[dict[str, Any]] = field(default_factory=list)
    candidate_ids: set[str] = field(default_factory=set)


def paragraph_id_from_unit(unit_id: str | None, fallback: str) -> str:
    if not unit_id:
        return fallback
    match = PARAGRAPH_ID_RE.match(unit_id)
    return match.group(1) if match else fallback


def boundary_separator(left_text: str, right_text: str, *, sentence_join: bool = False) -> str:
    if not left_text or not right_text:
        return ''
    if left_text[-1].isspace() or right_text[0].isspace():
        return ''
    left = left_text.rstrip()
    right = right_text.lstrip()
    if not left or not right:
        return ''
    left_char = left[-1]
    right_char = right[0]
    if left_char in NO_SPACE_AFTER or right_char in NO_SPACE_BEFORE:
        return ''
    if left_char.isalnum() and right_char.isalnum():
        return ' '
    if sentence_join and left_char not in '([{«“‘' and right_char not in NO_SPACE_BEFORE:
        return ' '
    return ''


def tokenize_into(text: str, language: str, segment_id: str, candidate_ids: list[str], offset: int) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    for index, match in enumerate(TOKEN_RE.finditer(text), start=1):
        token_language = language
        if token_language == 'hybrid':
            token_language = 'pl'
        tokens.append(
            {
                'id': f'{segment_id}-tok-{offset + match.start():06d}-{index:04d}',
                'text': match.group(0),
                'language': token_language,
                'start': offset + match.start(),
                'end': offset + match.end(),
                'candidateIds': list(dict.fromkeys(candidate_ids)),
            }
        )
    return tokens


def collect_candidates(candidates: list[dict[str, Any]], parent_id: str | None = None) -> tuple[dict[str, dict[str, Any]], dict[str, str | None]]:
    by_id: dict[str, dict[str, Any]] = {}
    parent_by_id: dict[str, str | None] = {}

    def visit(items: list[dict[str, Any]], current_parent_id: str | None) -> None:
        for candidate in items:
            candidate_id = candidate['candidate_id']
            by_id[candidate_id] = candidate
            parent_by_id[candidate_id] = current_parent_id
            child = candidate.get('child_alignment_artifact') or {}
            visit(child.get('candidates') or [], candidate_id)

    visit(candidates, parent_id)
    return by_id, parent_by_id


def root_candidate_id(candidate_id: str, parent_by_id: dict[str, str | None]) -> str:
    current = candidate_id
    while parent_by_id.get(current):
        current = parent_by_id[current] or current
    return current


def append_surface(
    *,
    text_parts: list[str],
    token_parts: list[dict[str, Any]],
    surface: str,
    language: str,
    segment_id: str,
    candidate_ids: list[str],
    sentence_join: bool = False,
) -> None:
    if not surface:
        return
    previous = ''.join(text_parts)
    separator = boundary_separator(previous, surface, sentence_join=sentence_join)
    if separator:
        text_parts.append(separator)
    offset = len(''.join(text_parts))
    text_parts.append(surface)
    token_parts.extend(tokenize_into(surface, language, segment_id, candidate_ids, offset))


def build_hybrid_unit(
    parent: dict[str, Any],
    selected_ids: list[str],
    selected_plan_by_id: dict[str, dict[str, Any]],
    candidate_by_id: dict[str, dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    parent_id = parent['candidate_id']
    source_text = parent.get('source_surface_text') or ''
    text_parts: list[str] = []
    token_parts: list[dict[str, Any]] = []
    segment_id = f'{parent_id}:hybrid'

    selected_candidates: list[dict[str, Any]] = []
    for candidate_id in selected_ids:
        candidate = candidate_by_id.get(candidate_id)
        if candidate is not None:
            selected_candidates.append(candidate)

    selected_candidates.sort(
        key=lambda item: (
            item.get('source_span', {}).get('char_start', 0),
            -(item.get('source_span', {}).get('char_end', 0) - item.get('source_span', {}).get('char_start', 0)),
        )
    )

    cursor = 0
    for candidate in selected_candidates:
        candidate_id = candidate['candidate_id']
        span = candidate.get('source_span') or {}
        start = int(span.get('char_start', 0))
        end = int(span.get('char_end', 0))
        if start < cursor or end <= start:
            continue
        append_surface(
            text_parts=text_parts,
            token_parts=token_parts,
            surface=source_text[cursor:start],
            language='pl',
            segment_id=segment_id,
            candidate_ids=[parent_id],
        )
        replacement = selected_plan_by_id.get(candidate_id, {}).get('target_surface_text') or candidate.get('target_surface_text') or ''
        append_surface(
            text_parts=text_parts,
            token_parts=token_parts,
            surface=replacement,
            language='cs',
            segment_id=segment_id,
            candidate_ids=[candidate_id, parent_id],
        )
        cursor = end

    append_surface(
        text_parts=text_parts,
        token_parts=token_parts,
        surface=source_text[cursor:],
        language='pl',
        segment_id=segment_id,
        candidate_ids=[parent_id],
    )
    return ''.join(text_parts), token_parts


def append_unit_to_paragraph(paragraph: ParagraphBuilder, parent: dict[str, Any], unit_text: str, unit_tokens: list[dict[str, Any]]) -> None:
    if not unit_text:
        return
    separator = boundary_separator(paragraph.text, unit_text, sentence_join=True)
    if separator:
        paragraph.text += separator
    offset = len(paragraph.text)
    paragraph.text += unit_text

    paragraph.source_unit_ids.extend(parent.get('source_unit_ids') or [])
    paragraph.target_unit_ids.extend(parent.get('target_unit_ids') or [])

    for token in unit_tokens:
        shifted = dict(token)
        shifted['id'] = f'{paragraph.id}:hybrid-tok-{shifted["start"] + offset:06d}'
        shifted['start'] += offset
        shifted['end'] += offset
        paragraph.tokens.append(shifted)
        paragraph.candidate_ids.update(shifted['candidateIds'])


def build_fixture(alignment: dict[str, Any], plan: dict[str, Any]) -> dict[str, Any]:
    candidate_by_id, parent_by_id = collect_candidates(alignment['candidates'])
    selected_plan_by_id = {candidate['candidate_id']: candidate for candidate in plan.get('selected_candidates') or []}

    selected_by_root: dict[str, list[str]] = {}
    for candidate_id in selected_plan_by_id:
        root_id = root_candidate_id(candidate_id, parent_by_id)
        selected_by_root.setdefault(root_id, []).append(candidate_id)

    candidate_records: dict[str, CandidateRecord] = {}
    paragraphs: list[ParagraphBuilder] = []
    paragraph_by_id: dict[str, ParagraphBuilder] = {}

    for parent in alignment['candidates']:
        parent_id = parent['candidate_id']
        source_unit_ids = parent.get('source_unit_ids') or []
        target_unit_ids = parent.get('target_unit_ids') or []
        paragraph_id = paragraph_id_from_unit(source_unit_ids[0] if source_unit_ids else None, f'chapter-016-p-{len(paragraphs) + 1:04d}')
        target_paragraph_id = paragraph_id_from_unit(target_unit_ids[0] if target_unit_ids else None, f'chapter-016-target-p-{len(paragraphs) + 1:04d}')
        paragraph = paragraph_by_id.get(paragraph_id)
        if paragraph is None:
            paragraph = ParagraphBuilder(id=paragraph_id, target_id=target_paragraph_id)
            paragraph_by_id[paragraph_id] = paragraph
            paragraphs.append(paragraph)

        candidate_records[parent_id] = CandidateRecord(
            id=parent_id,
            type=parent.get('candidate_type') or alignment.get('alignment_level') or 'discourse_unit',
            source_unit_ids=source_unit_ids,
            target_unit_ids=target_unit_ids,
            source_text=parent.get('source_surface_text') or '',
            target_text=parent.get('target_surface_text') or '',
            score=parent.get('alignment_confidence'),
            parent_id=None,
        )

        for selected_id in selected_by_root.get(parent_id, []):
            selected = candidate_by_id[selected_id]
            selected_plan = selected_plan_by_id.get(selected_id) or {}
            candidate_records[selected_id] = CandidateRecord(
                id=selected_id,
                type=selected.get('candidate_type') or 'span',
                source_unit_ids=selected.get('source_unit_ids') or source_unit_ids,
                target_unit_ids=selected.get('target_unit_ids') or target_unit_ids,
                source_text=selected.get('source_surface_text') or selected_plan.get('source_span', {}).get('surface') or '',
                target_text=selected_plan.get('target_surface_text') or selected.get('target_surface_text') or '',
                score=selected.get('alignment_confidence'),
                parent_id=parent_id,
            )

        unit_text, unit_tokens = build_hybrid_unit(parent, selected_by_root.get(parent_id, []), selected_plan_by_id, candidate_by_id)
        append_unit_to_paragraph(paragraph, parent, unit_text, unit_tokens)

    for paragraph in paragraphs:
        for token in paragraph.tokens:
            for candidate_id in token['candidateIds']:
                record = candidate_records.get(candidate_id)
                if record is None:
                    continue
                record.token_ids.append(token['id'])
                if token['language'] == 'cs':
                    record.target_token_ids.append(token['id'])
                else:
                    record.source_token_ids.append(token['id'])

    paragraphs_out: list[dict[str, Any]] = []
    for paragraph in paragraphs:
        segment_id = f'{paragraph.id}:hybrid'
        paragraphs_out.append(
            {
                'id': paragraph.id,
                'targetParagraphId': paragraph.target_id,
                'sourceUnitIds': list(dict.fromkeys(paragraph.source_unit_ids)),
                'targetUnitIds': list(dict.fromkeys(paragraph.target_unit_ids)),
                'segments': [
                    {
                        'id': segment_id,
                        'language': 'hybrid',
                        'text': paragraph.text,
                        'tokens': paragraph.tokens,
                        'candidateIds': sorted(paragraph.candidate_ids),
                    }
                ],
            }
        )

    candidates_out = [
        {
            'id': record.id,
            'type': record.type,
            'sourceUnitIds': record.source_unit_ids,
            'targetUnitIds': record.target_unit_ids,
            'sourceText': record.source_text,
            'targetText': record.target_text,
            'score': record.score,
            'tokenIds': list(dict.fromkeys(record.token_ids)),
            'sourceTokenIds': list(dict.fromkeys(record.source_token_ids)),
            'targetTokenIds': list(dict.fromkeys(record.target_token_ids)),
            'parentId': record.parent_id,
        }
        for record in candidate_records.values()
    ]

    return {
        'metadata': {
            'sourceArtifactPath': str(ALIGNMENT_SOURCE),
            'hybridizationPlanPath': str(PLAN_SOURCE),
            'sourceArtifactId': alignment['artifact_id'],
            'hybridizationPlanAlignmentArtifactId': plan.get('metadata', {}).get('alignment_artifact_id'),
            'sourceParentUnitId': alignment.get('source_parent_unit_id'),
            'targetParentUnitId': alignment.get('target_parent_unit_id'),
            'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'fixtureKind': 'szwejk-chapter-016-hybridization-smoke-derived',
        },
        'work': {
            'id': 'work-szwejk',
            'slug': 'szwejk',
            'title': 'Dobry wojak Szwejk',
            'sourceLanguage': alignment.get('source_lang') or 'pl',
            'targetLanguage': alignment.get('target_lang') or 'cs',
            'volumes': [
                {
                    'id': 'volume-1',
                    'label': 'Tom I',
                    'status': 'available',
                    'chapters': [
                        {
                            'id': 'chapter-016',
                            'title': 'Tom I, rozdział 16',
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
    alignment = json.loads(ALIGNMENT_SOURCE.read_text(encoding='utf-8'))
    plan = json.loads(PLAN_SOURCE.read_text(encoding='utf-8'))
    fixture = build_fixture(alignment, plan)
    (OUT_DIR / 'reader-fixture.json').write_text(json.dumps(fixture, ensure_ascii=False, indent=2), encoding='utf-8')


if __name__ == '__main__':
    main()

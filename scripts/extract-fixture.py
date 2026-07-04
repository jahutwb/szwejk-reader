#!/usr/bin/env python3
"""Extract a reader fixture from real hybrydyzer fullbook artifacts.

The project reader uses compact, structured JSON fixtures. This script reads
the large hybrydyzer alignment/hybridization artifacts outside this repository
and writes only the first volume render fixture needed by the MVP reader.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALIGNMENT_DIR = Path(
    '/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/'
    'coverage_tiles_selfslot_v0_fullbook/work/segment_checkpoints'
)
PLAN_SOURCE = Path(
    '/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/'
    'coverage_tiles_selfslot_v0_fullbook_hybridization/hybridization/'
    'hybridization_plan.coverage_tiles_selfslot_v0_fullbook.json'
)
OUT_DIR = Path('/home/jahu/PycharmProjects/szwejk-reader/public/data/fixtures/szwejk-mini')

VOLUME_1_CHAPTERS = tuple(range(1, 18))
CHAPTER_TITLES_PL = {
    1: 'Wstęp',
    2: 'Jak dobry wojak Szwejk wkroczył na widownię wojny światowej',
    3: 'Dobry wojak Szwejk w dyrekcji policji',
    4: 'Szwejk przed lekarzami sądowymi',
    5: 'Szwejk wypędzony z domu wariatów',
    6: 'Szwejk w komisariacie policji przy ulicy Salma',
    7: 'Szwejk przerywa zaczarowane koło i wraca do domu',
    8: 'Szwejk rusza na wojnę',
    9: 'Szwejk symulantem',
    10: 'Szwejk w garnizonie',
    11: 'Szwejk zostaje pucybutem kapelana polowego',
    12: 'Szwejk jedzie z kapelanem odprawić mszę polową',
    13: 'Dysputa religijna',
    14: 'Szwejk idzie namaszczać',
    15: 'Szwejk zostaje pucybutem porucznika Lukasza',
    16: 'Katastrofa',
    17: 'Epilog',
}

TOKEN_RE = re.compile(r'\w+|[^\w\s]', re.UNICODE)
PARAGRAPH_ID_RE = re.compile(r'(.+-ch-\d+-p-\d+)')
CHAPTER_RE = re.compile(r'-ch-(\d{3})')
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


def chapter_id(chapter_number: int) -> str:
    return f'chapter-{chapter_number:03d}'


def chapter_number_from_text(value: str | None) -> int | None:
    if not value:
        return None
    match = CHAPTER_RE.search(value)
    return int(match.group(1)) if match else None


def chapter_number_from_candidate(candidate: dict[str, Any]) -> int | None:
    chapter = chapter_number_from_text(candidate.get('candidate_id'))
    if chapter is not None:
        return chapter
    for key in ('source_unit_id', 'parent_unit_id'):
        chapter = chapter_number_from_text(candidate.get(key))
        if chapter is not None:
            return chapter
    for key in ('source_unit_ids', 'target_unit_ids'):
        for unit_id in candidate.get(key) or []:
            chapter = chapter_number_from_text(unit_id)
            if chapter is not None:
                return chapter
    return None


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
    if sentence_join and left_char not in NO_SPACE_AFTER and right_char not in NO_SPACE_BEFORE:
        return ' '
    return ''


def span_start_end(candidate: dict[str, Any]) -> tuple[int, int]:
    span = candidate.get('source_span') or {}
    start = span.get('char_start', span.get('start_char', 0))
    end = span.get('char_end', span.get('end_char', 0))
    return int(start or 0), int(end or 0)


def tokenize_into(text: str, language: str, segment_id: str, candidate_ids: list[str], offset: int) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    for index, match in enumerate(TOKEN_RE.finditer(text), start=1):
        token_language = 'pl' if language == 'hybrid' else language
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


def collect_candidates(candidates: list[dict[str, Any]]) -> tuple[dict[str, dict[str, Any]], dict[str, str | None]]:
    by_id: dict[str, dict[str, Any]] = {}
    parent_by_id: dict[str, str | None] = {}

    def visit(items: list[dict[str, Any]], current_parent_id: str | None) -> None:
        for candidate in items:
            candidate_id_value = candidate['candidate_id']
            by_id[candidate_id_value] = candidate
            parent_by_id[candidate_id_value] = current_parent_id
            child = candidate.get('child_alignment_artifact') or {}
            visit(child.get('candidates') or [], candidate_id_value)

    visit(candidates, None)
    return by_id, parent_by_id


def candidate_hierarchy_ids(candidate_id: str, parent_by_id: dict[str, str | None]) -> list[str]:
    ids = [candidate_id]
    current = candidate_id
    while parent_by_id.get(current):
        current = parent_by_id[current] or current
        ids.append(current)
    return ids


def root_candidate_id(candidate_id: str, parent_by_id: dict[str, str | None]) -> str:
    return candidate_hierarchy_ids(candidate_id, parent_by_id)[-1]


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
    parent_by_id: dict[str, str | None],
) -> tuple[str, list[dict[str, Any]]]:
    parent_id = parent['candidate_id']
    source_text = parent.get('source_surface_text') or ''
    text_parts: list[str] = []
    token_parts: list[dict[str, Any]] = []
    segment_id = f'{parent_id}:hybrid'

    selected_candidates = [candidate_by_id[candidate_id] for candidate_id in selected_ids if candidate_id in candidate_by_id]
    selected_candidates.sort(
        key=lambda item: (
            span_start_end(item)[0],
            -(span_start_end(item)[1] - span_start_end(item)[0]),
        )
    )

    cursor = 0
    for candidate in selected_candidates:
        candidate_id_value = candidate['candidate_id']
        start, end = span_start_end(candidate)
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
        replacement = selected_plan_by_id.get(candidate_id_value, {}).get('target_surface_text') or candidate.get('target_surface_text') or ''
        append_surface(
            text_parts=text_parts,
            token_parts=token_parts,
            surface=replacement,
            language='cs',
            segment_id=segment_id,
            candidate_ids=candidate_hierarchy_ids(candidate_id_value, parent_by_id),
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


def make_candidate_record(
    candidate: dict[str, Any],
    selected_plan_by_id: dict[str, dict[str, Any]],
    parent_by_id: dict[str, str | None],
    fallback_source_unit_ids: list[str],
    fallback_target_unit_ids: list[str],
) -> CandidateRecord:
    candidate_id_value = candidate['candidate_id']
    selected_plan = selected_plan_by_id.get(candidate_id_value) or {}
    selected_source_span = selected_plan.get('source_span') or {}
    return CandidateRecord(
        id=candidate_id_value,
        type=candidate.get('candidate_type') or 'span',
        source_unit_ids=candidate.get('source_unit_ids') or fallback_source_unit_ids,
        target_unit_ids=candidate.get('target_unit_ids') or fallback_target_unit_ids,
        source_text=candidate.get('source_surface_text') or selected_source_span.get('surface') or '',
        target_text=selected_plan.get('target_surface_text') or candidate.get('target_surface_text') or '',
        score=candidate.get('alignment_confidence'),
        parent_id=parent_by_id.get(candidate_id_value),
    )


def build_chapter(alignment: dict[str, Any], selected_candidates: list[dict[str, Any]], chapter_number: int) -> tuple[dict[str, Any], dict[str, Any]]:
    candidate_by_id, parent_by_id = collect_candidates(alignment['candidates'])
    selected_plan_by_id = {
        candidate['candidate_id']: candidate
        for candidate in selected_candidates
        if candidate.get('candidate_id') in candidate_by_id
    }

    selected_by_root: dict[str, list[str]] = {}
    for candidate_id_value in selected_plan_by_id:
        root_id = root_candidate_id(candidate_id_value, parent_by_id)
        selected_by_root.setdefault(root_id, []).append(candidate_id_value)

    candidate_records: dict[str, CandidateRecord] = {}
    paragraphs: list[ParagraphBuilder] = []
    paragraph_by_id: dict[str, ParagraphBuilder] = {}

    def ensure_candidate_record(
        candidate_id_value: str,
        fallback_source_unit_ids: list[str],
        fallback_target_unit_ids: list[str],
    ) -> None:
        if candidate_id_value in candidate_records:
            return
        candidate = candidate_by_id.get(candidate_id_value)
        if candidate is None:
            return
        candidate_records[candidate_id_value] = make_candidate_record(
            candidate,
            selected_plan_by_id,
            parent_by_id,
            fallback_source_unit_ids,
            fallback_target_unit_ids,
        )

    for parent in alignment['candidates']:
        parent_id = parent['candidate_id']
        source_unit_ids = parent.get('source_unit_ids') or []
        target_unit_ids = parent.get('target_unit_ids') or []
        paragraph_id = paragraph_id_from_unit(source_unit_ids[0] if source_unit_ids else None, f'{chapter_id(chapter_number)}-p-{len(paragraphs) + 1:04d}')
        target_paragraph_id = paragraph_id_from_unit(
            target_unit_ids[0] if target_unit_ids else None,
            f'{chapter_id(chapter_number)}-target-p-{len(paragraphs) + 1:04d}',
        )
        paragraph = paragraph_by_id.get(paragraph_id)
        if paragraph is None:
            paragraph = ParagraphBuilder(id=paragraph_id, target_id=target_paragraph_id)
            paragraph_by_id[paragraph_id] = paragraph
            paragraphs.append(paragraph)

        ensure_candidate_record(parent_id, source_unit_ids, target_unit_ids)

        for selected_id in selected_by_root.get(parent_id, []):
            for hierarchy_id in candidate_hierarchy_ids(selected_id, parent_by_id):
                ensure_candidate_record(hierarchy_id, source_unit_ids, target_unit_ids)

        unit_text, unit_tokens = build_hybrid_unit(
            parent,
            selected_by_root.get(parent_id, []),
            selected_plan_by_id,
            candidate_by_id,
            parent_by_id,
        )
        append_unit_to_paragraph(paragraph, parent, unit_text, unit_tokens)

    for paragraph in paragraphs:
        for token in paragraph.tokens:
            for candidate_id_value in token['candidateIds']:
                record = candidate_records.get(candidate_id_value)
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

    chapter = {
        'id': chapter_id(chapter_number),
        'title': CHAPTER_TITLES_PL[chapter_number],
        'paragraphs': paragraphs_out,
        'candidates': candidates_out,
        'footnotes': [],
        'glossary': [],
    }
    stats = {
        'chapterId': chapter['id'],
        'sourceArtifactId': alignment['artifact_id'],
        'selectedCandidateCount': len(selected_plan_by_id),
        'paragraphCount': len(paragraphs_out),
        'candidateCount': len(candidates_out),
        'tokenCount': sum(len(paragraph.tokens) for paragraph in paragraphs),
    }
    return chapter, stats


def build_fixture() -> dict[str, Any]:
    plan = json.loads(PLAN_SOURCE.read_text(encoding='utf-8'))
    selected_by_chapter: dict[int, list[dict[str, Any]]] = {number: [] for number in VOLUME_1_CHAPTERS}
    for candidate in plan.get('selected_candidates') or []:
        chapter_number = chapter_number_from_candidate(candidate)
        if chapter_number in selected_by_chapter:
            selected_by_chapter[chapter_number].append(candidate)

    chapters: list[dict[str, Any]] = []
    chapter_stats: list[dict[str, Any]] = []
    source_artifact_paths: list[str] = []
    source_language = 'pl'
    target_language = 'cs'

    for chapter_number in VOLUME_1_CHAPTERS:
        alignment_path = ALIGNMENT_DIR / f'chapter_{chapter_number:03d}.json'
        alignment = json.loads(alignment_path.read_text(encoding='utf-8'))
        source_artifact_paths.append(str(alignment_path))
        source_language = alignment.get('source_lang') or source_language
        target_language = alignment.get('target_lang') or target_language
        chapter, stats = build_chapter(alignment, selected_by_chapter[chapter_number], chapter_number)
        chapters.append(chapter)
        chapter_stats.append(stats)

    return {
        'metadata': {
            'sourceArtifactPath': str(ALIGNMENT_DIR),
            'sourceArtifactPaths': source_artifact_paths,
            'hybridizationPlanPath': str(PLAN_SOURCE),
            'hybridizationPlanAlignmentArtifactId': plan.get('metadata', {}).get('alignment_artifact_id'),
            'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'fixtureKind': 'szwejk-volume-1-fullbook-hybridization-derived',
            'chapterStats': chapter_stats,
        },
        'work': {
            'id': 'work-szwejk',
            'slug': 'szwejk',
            'title': 'Dobry wojak Szwejk',
            'sourceLanguage': source_language,
            'targetLanguage': target_language,
            'volumes': [
                {
                    'id': 'volume-1',
                    'label': 'Tom I',
                    'status': 'available',
                    'chapters': chapters,
                },
                {'id': 'volume-2', 'label': 'Tom II', 'status': 'locked', 'chapters': []},
                {'id': 'volume-3', 'label': 'Tom III', 'status': 'soon', 'chapters': []},
                {'id': 'volume-4', 'label': 'Tom IV', 'status': 'soon', 'chapters': []},
            ],
        },
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    fixture = build_fixture()
    (OUT_DIR / 'reader-fixture.json').write_text(
        json.dumps(fixture, ensure_ascii=False, separators=(',', ':')),
        encoding='utf-8',
    )


if __name__ == '__main__':
    main()

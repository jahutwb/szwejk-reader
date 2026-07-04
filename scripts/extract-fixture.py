#!/usr/bin/env python3
"""Extract a reader fixture from the current v13 hybrydyzer artifacts."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

ALIGNMENT_SOURCE = Path(
    '/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/'
    'fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_segment_rebuild_v1/'
    'alignment/'
    'szwejk_discourse_alignment.fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_segment_rebuild_v1.'
    'syntax_forest_coverage_tiles_selfslot.json'
)
PLAN_SOURCE = Path(
    '/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/'
    'fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1/'
    'hybridization/'
    'hybridization_plan.fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1.json'
)
NOTES_SOURCE = Path(
    '/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/'
    'fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1_render_notesfix_glossary_v1/'
    'notes/'
    'notes_glossary_plan.fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1_'
    'render_notesfix_glossary_v1.json'
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
DUPLICATE_INLINE_PUNCT_RE = re.compile(r'([,.;:!?])\s+\1(?=\s|$)')


@dataclass
class FlatCandidate:
    id: str
    type: str
    source_unit_ids: list[str]
    target_unit_ids: list[str]
    source_text: str
    target_text: str
    source_start: int
    source_end: int
    target_start: int
    target_end: int
    score: float | None
    score_components: dict[str, float]
    parent_id: str | None
    root_id: str
    unit_id: str
    depth: int
    selected: bool = False
    selection_mode: str | None = None
    application_order: int | None = None
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


def build_execution_unit_id(source_unit_ids: list[str]) -> str:
    if len(source_unit_ids) == 1:
        return source_unit_ids[0]
    return '__group__' + '__'.join(source_unit_ids)


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


def normalize_note_display_fragment(text: str | None) -> str:
    normalized = re.sub(r'\s+', ' ', text or '').strip()
    if normalized.endswith('.') and not normalized.endswith('...'):
        normalized = normalized[:-1].rstrip()
    return normalized


def render_footnote_text(note: dict[str, Any]) -> str:
    target = normalize_note_display_fragment(note.get('target_fragment'))
    literal = normalize_note_display_fragment(note.get('source_literal_fragment'))
    meaning = normalize_note_display_fragment(note.get('source_translation_fragment'))
    if note.get('note_type') == 'idiomatic' and meaning:
        return f'{target} — dosł. {literal}; sens: {meaning}'
    return f'{target} — {literal}'


def cleanup_duplicate_inline_punctuation(text: str) -> str:
    previous = None
    current = text
    while current != previous:
        previous = current
        current = DUPLICATE_INLINE_PUNCT_RE.sub(r'\1', current)
    return current


def span_start_end(candidate: dict[str, Any], key: str = 'source_span') -> tuple[int, int]:
    span = candidate.get(key) or {}
    start = span.get('char_start', span.get('start_char', 0))
    end = span.get('char_end', span.get('end_char', 0))
    return int(start or 0), int(end or 0)


def selected_source_start(candidate: dict[str, Any]) -> int:
    span = candidate.get('absolute_source_span') or candidate.get('source_span') or {}
    return int(span.get('start_char', 0) or 0)


def selected_source_end(candidate: dict[str, Any]) -> int:
    span = candidate.get('absolute_source_span') or candidate.get('source_span') or {}
    return int(span.get('end_char', 0) or 0)


def selected_target_start(candidate: dict[str, Any], fallback: int) -> int:
    span = candidate.get('absolute_target_span') or candidate.get('target_span') or {}
    return int(span.get('start_char', fallback) or fallback)


def flatten_candidate_tree(
    candidate: dict[str, Any],
    *,
    unit_id: str,
    absolute_source_offset: int,
    absolute_target_offset: int,
    root_id: str | None = None,
    parent_id: str | None = None,
    depth: int = 0,
) -> list[FlatCandidate]:
    source_start, source_end = span_start_end(candidate, 'source_span')
    target_start, target_end = span_start_end(candidate, 'target_span')
    absolute_source_start = absolute_source_offset + source_start
    absolute_source_end = absolute_source_offset + source_end
    absolute_target_start = absolute_target_offset + target_start
    absolute_target_end = absolute_target_offset + target_end
    candidate_id = candidate['candidate_id']
    resolved_root_id = root_id or candidate_id
    flat = FlatCandidate(
        id=candidate_id,
        type=candidate.get('candidate_type') or 'span',
        source_unit_ids=candidate.get('source_unit_ids') or [],
        target_unit_ids=candidate.get('target_unit_ids') or [],
        source_text=candidate.get('source_surface_text') or '',
        target_text=candidate.get('target_surface_text') or '',
        source_start=absolute_source_start,
        source_end=absolute_source_end,
        target_start=absolute_target_start,
        target_end=absolute_target_end,
        score=candidate.get('alignment_confidence'),
        score_components=candidate.get('score_components') or {},
        parent_id=parent_id,
        root_id=resolved_root_id,
        unit_id=unit_id,
        depth=depth,
    )
    flattened = [flat]
    child_artifact = candidate.get('child_alignment_artifact') or {}
    for child in child_artifact.get('candidates') or []:
        flattened.extend(
            flatten_candidate_tree(
                child,
                unit_id=unit_id,
                absolute_source_offset=absolute_source_start,
                absolute_target_offset=absolute_target_start,
                root_id=resolved_root_id,
                parent_id=candidate_id,
                depth=depth + 1,
            )
        )
    return flattened


def candidate_ids_for_source_span(candidates: list[FlatCandidate], start: int, end: int) -> list[str]:
    containing = [
        candidate
        for candidate in candidates
        if candidate.source_start <= start and end <= candidate.source_end
    ]
    containing.sort(key=lambda item: (item.source_end - item.source_start, -item.depth, item.type, item.id))
    return [candidate.id for candidate in containing]


def candidate_ids_for_target_span(candidates: list[FlatCandidate], start: int, end: int) -> list[str]:
    containing = [
        candidate
        for candidate in candidates
        if candidate.target_start <= start and end <= candidate.target_end
    ]
    containing.sort(key=lambda item: (item.target_end - item.target_start, -item.depth, item.type, item.id))
    return [candidate.id for candidate in containing]


def hierarchy_ids(candidate_id: str, candidate_records: dict[str, FlatCandidate]) -> list[str]:
    ids = [candidate_id]
    current = candidate_records.get(candidate_id)
    while current is not None and current.parent_id:
        ids.append(current.parent_id)
        current = candidate_records.get(current.parent_id)
    return ids


def append_unique(left: list[str], right: list[str]) -> list[str]:
    return list(dict.fromkeys([*left, *right]))


def intro_ranges_for_token(
    *,
    token_start: int,
    token_end: int,
    intros: list[dict[str, Any]],
    notes_by_intro: dict[str, dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[str], list[str]]:
    ranges: list[dict[str, Any]] = []
    intro_ids: list[str] = []
    footnote_ids: list[str] = []
    for intro in intros:
        span = intro.get('char_span_in_target') or {}
        intro_start = int(span.get('start_char', 0) or 0)
        intro_end = int(span.get('end_char', 0) or 0)
        overlap_start = max(token_start, intro_start)
        overlap_end = min(token_end, intro_end)
        if overlap_start >= overlap_end:
            continue
        intro_id = intro['intro_id']
        note = notes_by_intro.get(intro_id)
        footnote_id = note.get('note_id') if note else None
        intro_ids.append(intro_id)
        if footnote_id:
            footnote_ids.append(footnote_id)
        ranges.append(
            {
                'introId': intro_id,
                'start': overlap_start - token_start,
                'end': overlap_end - token_start,
                'footnoteId': footnote_id,
            }
        )
    return ranges, list(dict.fromkeys(intro_ids)), list(dict.fromkeys(footnote_ids))


def tokenize_surface(
    *,
    surface: str,
    language: str,
    segment_id: str,
    offset: int,
    unit_candidates: list[FlatCandidate],
    fallback_candidate_ids: list[str],
    source_start: int | None = None,
    target_start: int | None = None,
    intros: list[dict[str, Any]] | None = None,
    notes_by_intro: dict[str, dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    tokens: list[dict[str, Any]] = []
    intros = intros or []
    notes_by_intro = notes_by_intro or {}
    for index, match in enumerate(TOKEN_RE.finditer(surface), start=1):
        local_start = match.start()
        local_end = match.end()
        if language == 'cs' and target_start is not None:
            candidate_ids = append_unique(
                candidate_ids_for_target_span(
                    unit_candidates,
                    target_start + local_start,
                    target_start + local_end,
                ),
                fallback_candidate_ids,
            )
        elif source_start is not None:
            candidate_ids = append_unique(
                candidate_ids_for_source_span(
                    unit_candidates,
                    source_start + local_start,
                    source_start + local_end,
                ),
                fallback_candidate_ids,
            )
        else:
            candidate_ids = list(dict.fromkeys(fallback_candidate_ids))

        token: dict[str, Any] = {
            'id': f'{segment_id}-tok-{offset + local_start:06d}-{index:04d}',
            'text': match.group(0),
            'language': language,
            'start': offset + local_start,
            'end': offset + local_end,
            'candidateIds': candidate_ids,
        }
        if source_start is not None:
            token['sourceStart'] = source_start + local_start
            token['sourceEnd'] = source_start + local_end
        if target_start is not None:
            token['targetStart'] = target_start + local_start
            token['targetEnd'] = target_start + local_end
        if language == 'cs' and intros:
            ranges, intro_ids, footnote_ids = intro_ranges_for_token(
                token_start=local_start,
                token_end=local_end,
                intros=intros,
                notes_by_intro=notes_by_intro,
            )
            if ranges:
                token['introRanges'] = ranges
                token['introIds'] = intro_ids
            if footnote_ids:
                token['footnoteIds'] = footnote_ids
        tokens.append(token)
    return tokens


def append_surface(
    *,
    text_parts: list[str],
    token_parts: list[dict[str, Any]],
    surface: str,
    language: str,
    segment_id: str,
    unit_candidates: list[FlatCandidate],
    fallback_candidate_ids: list[str],
    source_start: int | None = None,
    target_start: int | None = None,
    intros: list[dict[str, Any]] | None = None,
    notes_by_intro: dict[str, dict[str, Any]] | None = None,
) -> None:
    if not surface:
        return
    cleaned = cleanup_duplicate_inline_punctuation(surface)
    previous = ''.join(text_parts)
    separator = boundary_separator(previous, cleaned)
    if separator:
        text_parts.append(separator)
    offset = len(''.join(text_parts))
    text_parts.append(cleaned)
    token_parts.extend(
        tokenize_surface(
            surface=cleaned,
            language=language,
            segment_id=segment_id,
            offset=offset,
            unit_candidates=unit_candidates,
            fallback_candidate_ids=fallback_candidate_ids,
            source_start=source_start,
            target_start=target_start,
            intros=intros,
            notes_by_intro=notes_by_intro,
        )
    )


def render_execution_unit(
    root: dict[str, Any],
    *,
    selected_candidates: list[dict[str, Any]],
    unit_candidates: list[FlatCandidate],
    candidate_records: dict[str, FlatCandidate],
    intros_by_candidate: dict[str, list[dict[str, Any]]],
    notes_by_intro: dict[str, dict[str, Any]],
) -> tuple[str, list[dict[str, Any]]]:
    root_id = root['candidate_id']
    source_text = root.get('source_surface_text') or ''
    root_start, _ = span_start_end(root, 'source_span')
    unit_id = build_execution_unit_id(root.get('source_unit_ids') or [])
    segment_id = f'{root_id}:hybrid'
    text_parts: list[str] = []
    token_parts: list[dict[str, Any]] = []
    selected_candidates = [
        candidate
        for candidate in selected_candidates
        if selected_source_end(candidate) > selected_source_start(candidate)
    ]
    selected_candidates.sort(
        key=lambda item: (
            selected_source_start(item),
            selected_source_end(item),
            item.get('application_order', 0),
            item.get('candidate_id', ''),
        )
    )

    cursor = 0
    for selected in selected_candidates:
        selected_id = selected['candidate_id']
        absolute_start = selected_source_start(selected)
        absolute_end = selected_source_end(selected)
        local_start = absolute_start - root_start
        local_end = absolute_end - root_start
        if local_start < cursor or local_end <= local_start:
            continue
        append_surface(
            text_parts=text_parts,
            token_parts=token_parts,
            surface=source_text[cursor:local_start],
            language='pl',
            segment_id=segment_id,
            unit_candidates=unit_candidates,
            fallback_candidate_ids=[root_id],
            source_start=root_start + cursor,
        )
        target_surface = selected.get('target_surface_text') or selected.get('base_text') or ''
        selected_record = candidate_records.get(selected_id)
        fallback_ids = hierarchy_ids(selected_id, candidate_records) if selected_record else [selected_id, root_id]
        append_surface(
            text_parts=text_parts,
            token_parts=token_parts,
            surface=target_surface,
            language='cs',
            segment_id=segment_id,
            unit_candidates=unit_candidates,
            fallback_candidate_ids=fallback_ids,
            target_start=selected_target_start(selected, selected_record.target_start if selected_record else 0),
            intros=intros_by_candidate.get(selected_id) or [],
            notes_by_intro=notes_by_intro,
        )
        cursor = local_end

    append_surface(
        text_parts=text_parts,
        token_parts=token_parts,
        surface=source_text[cursor:],
        language='pl',
        segment_id=segment_id,
        unit_candidates=unit_candidates,
        fallback_candidate_ids=[root_id],
        source_start=root_start + cursor,
    )
    return ''.join(text_parts), token_parts


def append_unit_to_paragraphs(
    *,
    paragraphs: list[ParagraphBuilder],
    paragraph_by_id: dict[str, ParagraphBuilder],
    root: dict[str, Any],
    unit_text: str,
    unit_tokens: list[dict[str, Any]],
    chapter_number: int,
) -> None:
    if not unit_text:
        return
    source_unit_ids = root.get('source_unit_ids') or []
    target_unit_ids = root.get('target_unit_ids') or []
    source_paragraph_ids = list(dict.fromkeys(paragraph_id_from_unit(unit_id, '') for unit_id in source_unit_ids))
    source_paragraph_ids = [paragraph_id for paragraph_id in source_paragraph_ids if paragraph_id]
    target_paragraph_ids = list(dict.fromkeys(paragraph_id_from_unit(unit_id, '') for unit_id in target_unit_ids))
    target_paragraph_ids = [paragraph_id for paragraph_id in target_paragraph_ids if paragraph_id]
    text_parts = re.split(r'(\n+)', unit_text)
    cursor = 0
    rendered_part_index = 0
    for raw_part in text_parts:
        if not raw_part:
            continue
        part_start = cursor
        part_end = cursor + len(raw_part)
        cursor = part_end
        if raw_part.isspace() and '\n' in raw_part:
            rendered_part_index += 1
            continue
        paragraph_id = source_paragraph_ids[min(rendered_part_index, len(source_paragraph_ids) - 1)] if source_paragraph_ids else f'{chapter_id(chapter_number)}-p-{len(paragraphs) + 1:04d}'
        target_paragraph_id = target_paragraph_ids[min(rendered_part_index, len(target_paragraph_ids) - 1)] if target_paragraph_ids else f'{chapter_id(chapter_number)}-target-p-{len(paragraphs) + 1:04d}'
        paragraph = paragraph_by_id.get(paragraph_id)
        if paragraph is None:
            paragraph = ParagraphBuilder(id=paragraph_id, target_id=target_paragraph_id)
            paragraph_by_id[paragraph_id] = paragraph
            paragraphs.append(paragraph)
        separator = boundary_separator(paragraph.text, raw_part, sentence_join=True)
        if separator:
            paragraph.text += separator
        offset = len(paragraph.text)
        paragraph.text += raw_part
        paragraph.source_unit_ids.extend(source_unit_ids)
        paragraph.target_unit_ids.extend(target_unit_ids)
        for token in unit_tokens:
            if token['start'] < part_start or token['end'] > part_end:
                continue
            shifted = dict(token)
            shifted['id'] = f'{paragraph.id}:hybrid-tok-{shifted["start"] - part_start + offset:06d}'
            shifted['start'] = shifted['start'] - part_start + offset
            shifted['end'] = shifted['end'] - part_start + offset
            paragraph.tokens.append(shifted)
            paragraph.candidate_ids.update(shifted['candidateIds'])


def candidate_to_json(record: FlatCandidate) -> dict[str, Any]:
    return {
        'id': record.id,
        'type': record.type,
        'sourceUnitIds': record.source_unit_ids,
        'targetUnitIds': record.target_unit_ids,
        'sourceText': record.source_text,
        'targetText': record.target_text,
        'score': record.score,
        'scoreComponents': record.score_components,
        'tokenIds': list(dict.fromkeys(record.token_ids)),
        'sourceTokenIds': list(dict.fromkeys(record.source_token_ids)),
        'targetTokenIds': list(dict.fromkeys(record.target_token_ids)),
        'parentId': record.parent_id,
        'rootId': record.root_id,
        'sourceStart': record.source_start,
        'sourceEnd': record.source_end,
        'targetStart': record.target_start,
        'targetEnd': record.target_end,
        'depth': record.depth,
        'selected': record.selected,
        'selectionMode': record.selection_mode,
        'applicationOrder': record.application_order,
    }


def build_chapter(
    chapter_alignment: dict[str, Any],
    *,
    selected_by_unit: dict[str, list[dict[str, Any]]],
    selected_by_id: dict[str, dict[str, Any]],
    intros_by_candidate: dict[str, list[dict[str, Any]]],
    notes_by_intro: dict[str, dict[str, Any]],
    glossary_by_intro: dict[str, dict[str, Any]],
    chapter_number: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    paragraphs: list[ParagraphBuilder] = []
    paragraph_by_id: dict[str, ParagraphBuilder] = {}
    candidate_records: dict[str, FlatCandidate] = {}
    candidates_by_unit: dict[str, list[FlatCandidate]] = {}

    for root in chapter_alignment['candidates']:
        unit_id = build_execution_unit_id(root.get('source_unit_ids') or [])
        flat_candidates = flatten_candidate_tree(
            root,
            unit_id=unit_id,
            absolute_source_offset=0,
            absolute_target_offset=0,
        )
        candidates_by_unit[unit_id] = flat_candidates
        for candidate in flat_candidates:
            if candidate.id in selected_by_id:
                selected = selected_by_id[candidate.id]
                candidate.selected = True
                candidate.selection_mode = selected.get('selection_mode')
                candidate.application_order = selected.get('application_order')
                candidate.target_text = selected.get('target_surface_text') or candidate.target_text
            candidate_records[candidate.id] = candidate

    for root in chapter_alignment['candidates']:
        unit_id = build_execution_unit_id(root.get('source_unit_ids') or [])
        unit_text, unit_tokens = render_execution_unit(
            root,
            selected_candidates=selected_by_unit.get(unit_id, []),
            unit_candidates=candidates_by_unit[unit_id],
            candidate_records=candidate_records,
            intros_by_candidate=intros_by_candidate,
            notes_by_intro=notes_by_intro,
        )
        append_unit_to_paragraphs(
            paragraphs=paragraphs,
            paragraph_by_id=paragraph_by_id,
            root=root,
            unit_text=unit_text,
            unit_tokens=unit_tokens,
            chapter_number=chapter_number,
        )

    used_footnote_ids: set[str] = set()
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
            used_footnote_ids.update(token.get('footnoteIds') or [])

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

    footnotes_out = []
    for note in notes_by_intro.values():
        note_id = note.get('note_id')
        if note_id not in used_footnote_ids:
            continue
        footnotes_out.append(
            {
                'id': note_id,
                'introId': note.get('anchor', {}).get('intro_id'),
                'candidateId': note.get('candidate_id'),
                'sourceUnitId': note.get('source_unit_id'),
                'targetLemma': note.get('target_lemma'),
                'noteType': note.get('note_type'),
                'targetFragment': note.get('target_fragment'),
                'sourceLiteralFragment': note.get('source_literal_fragment'),
                'sourceTranslationFragment': note.get('source_translation_fragment'),
                'text': render_footnote_text(note),
            }
        )
    footnotes_out.sort(key=lambda item: item['id'])

    chapter_intro_ids = {
        intro_id
        for paragraph in paragraphs
        for token in paragraph.tokens
        for intro_id in token.get('introIds') or []
    }
    glossary_out = [
        {
            'id': entry.get('target_lemma') or entry.get('headword_target_display'),
            'term': entry.get('headword_target_display') or entry.get('target_lemma'),
            'explanation': entry.get('headword_source_display') or '',
            'language': 'cs',
            'firstIntroId': entry.get('first_intro_id'),
            'firstNoteId': entry.get('first_note_id'),
            'surfaceForms': entry.get('all_surface_forms_target') or [],
        }
        for intro_id, entry in glossary_by_intro.items()
        if intro_id in chapter_intro_ids
    ]

    candidates_out = [candidate_to_json(record) for record in candidate_records.values()]
    candidates_out.sort(key=lambda item: (item['sourceStart'], item['sourceEnd'], item['depth'], item['id']))

    chapter = {
        'id': chapter_id(chapter_number),
        'title': CHAPTER_TITLES_PL[chapter_number],
        'paragraphs': paragraphs_out,
        'candidates': candidates_out,
        'footnotes': footnotes_out,
        'glossary': glossary_out,
    }
    stats = {
        'chapterId': chapter['id'],
        'sourceArtifactId': chapter_alignment['artifact_id'],
        'selectedCandidateCount': sum(len(items) for unit_id, items in selected_by_unit.items() if f'-ch-{chapter_number:03d}' in unit_id),
        'paragraphCount': len(paragraphs_out),
        'candidateCount': len(candidates_out),
        'tokenCount': sum(len(paragraph.tokens) for paragraph in paragraphs),
        'introTokenCount': sum(
            1
            for paragraph in paragraphs
            for token in paragraph.tokens
            if token.get('introIds')
        ),
        'footnoteCount': len(footnotes_out),
    }
    return chapter, stats


def build_fixture() -> dict[str, Any]:
    alignment = json.loads(ALIGNMENT_SOURCE.read_text(encoding='utf-8'))
    plan = json.loads(PLAN_SOURCE.read_text(encoding='utf-8'))
    notes_plan = json.loads(NOTES_SOURCE.read_text(encoding='utf-8'))

    selected_by_id = {candidate['candidate_id']: candidate for candidate in plan.get('selected_candidates') or []}
    selected_by_unit: dict[str, list[dict[str, Any]]] = {}
    for candidate in plan.get('selected_candidates') or []:
        chapter_number = chapter_number_from_candidate(candidate)
        if chapter_number not in VOLUME_1_CHAPTERS:
            continue
        selected_by_unit.setdefault(candidate['source_unit_id'], []).append(candidate)
    for candidates in selected_by_unit.values():
        candidates.sort(
            key=lambda item: (
                selected_source_start(item),
                selected_source_end(item),
                item.get('application_order', 0),
                item.get('candidate_id', ''),
            )
        )

    intros_by_candidate: dict[str, list[dict[str, Any]]] = {}
    for intro in plan.get('intro_annotations') or []:
        chapter_number = chapter_number_from_candidate(intro)
        if chapter_number in VOLUME_1_CHAPTERS:
            intros_by_candidate.setdefault(intro['candidate_id'], []).append(intro)
    for intros in intros_by_candidate.values():
        intros.sort(
            key=lambda item: (
                item.get('char_span_in_target', {}).get('start_char', 0),
                item.get('char_span_in_target', {}).get('end_char', 0),
                item.get('intro_id', ''),
            )
        )

    notes_by_intro = {
        note['anchor']['intro_id']: note
        for note in notes_plan.get('footnotes') or []
        if chapter_number_from_candidate(note) in VOLUME_1_CHAPTERS
    }
    glossary_by_intro = {
        entry['first_intro_id']: entry
        for entry in notes_plan.get('glossary') or []
        if entry.get('first_intro_id')
    }

    chapters: list[dict[str, Any]] = []
    chapter_stats: list[dict[str, Any]] = []
    for chapter_alignment in alignment.get('chapter_alignments') or []:
        chapter_number = chapter_number_from_text(chapter_alignment.get('source_parent_unit_id'))
        if chapter_number not in VOLUME_1_CHAPTERS:
            continue
        chapter, stats = build_chapter(
            chapter_alignment,
            selected_by_unit=selected_by_unit,
            selected_by_id=selected_by_id,
            intros_by_candidate=intros_by_candidate,
            notes_by_intro=notes_by_intro,
            glossary_by_intro=glossary_by_intro,
            chapter_number=chapter_number,
        )
        chapters.append(chapter)
        chapter_stats.append(stats)

    chapters.sort(key=lambda item: item['id'])
    chapter_stats.sort(key=lambda item: item['chapterId'])

    return {
        'metadata': {
            'sourceArtifactPath': str(ALIGNMENT_SOURCE),
            'hybridizationPlanPath': str(PLAN_SOURCE),
            'notesGlossaryPlanPath': str(NOTES_SOURCE),
            'sourceArtifactId': alignment.get('artifact_id'),
            'hybridizationPlanAlignmentArtifactId': plan.get('metadata', {}).get('alignment_artifact_id'),
            'generatedAt': datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
            'fixtureKind': 'szwejk-volume-1-v13-reader-derived',
            'chapterStats': chapter_stats,
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

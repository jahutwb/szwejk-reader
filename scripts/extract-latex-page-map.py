#!/usr/bin/env python3
"""Build a reader page map from the LaTeX-rendered PDF layout.

The PDF is used only as layout evidence. Reader text, stable IDs, tokens,
candidate metadata, and notes still come from reader-fixture.json.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_PDF = Path(
    "/home/jahu/PycharmProjects/hybrydyzer/data/artifacts/experiments/"
    "fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1_render_notesfix_glossary_v1/"
    "rendered/"
    "szwejk_hybridized.fullbook_consistent6_boundary_both_v1_manual_parent_realign_v3_qa_hybridization_v13_risky_editorial_v1_render_notesfix_glossary_v1.tom_1.pdf"
)
DEFAULT_FIXTURE = Path("public/data/fixtures/szwejk-mini/reader-fixture.json")
DEFAULT_OUTPUT = Path("public/data/fixtures/szwejk-mini/page-map-latex-v13-volume-1.json")
MAIN_TEXT_Y_MAX = 480.0
MIN_PAGE_NORM_CHARS = 48
ANCHOR_CHARS = 180
MIN_ANCHOR_CHARS = 40
SEARCH_BACKTRACK = 5000


def normalize_text(text: str) -> str:
    return "".join(character.casefold() for character in text if character.isalpha())


def load_fixture_paragraphs(fixture_path: Path) -> list[dict[str, Any]]:
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    paragraphs: list[dict[str, Any]] = []
    for chapter in fixture["work"]["volumes"][0]["chapters"]:
        for paragraph in chapter["paragraphs"]:
            segment = next(
                (item for item in paragraph["segments"] if item["language"] == "hybrid"),
                paragraph["segments"][0],
            )
            paragraphs.append(
                {
                    "chapter_id": chapter["id"],
                    "paragraph_id": paragraph["id"],
                    "text": segment["text"],
                }
            )
    return paragraphs


def build_normalized_fixture_index(paragraphs: list[dict[str, Any]]) -> tuple[str, list[tuple[int, int]]]:
    normalized: list[str] = []
    mapping: list[tuple[int, int]] = []
    for paragraph_index, paragraph in enumerate(paragraphs):
        for char_offset, character in enumerate(paragraph["text"]):
            if character.isalpha():
                normalized.append(character.casefold())
                mapping.append((paragraph_index, char_offset))
    return "".join(normalized), mapping


def extract_pdf_pages(pdf_path: Path) -> list[dict[str, Any]]:
    xml = subprocess.check_output(
        ["pdftotext", "-bbox-layout", str(pdf_path), "-"],
        text=True,
    )
    root = ET.fromstring(xml)
    pages: list[dict[str, Any]] = []
    for page_number, page in enumerate(root.findall(".//{*}page"), start=1):
        lines: list[list[str]] = []
        footer_words: list[str] = []
        for line in page.findall(".//{*}line"):
            y_max = float(line.attrib["yMax"])
            words = [word.text or "" for word in line.findall("{*}word")]
            if not words:
                continue
            if y_max > 500:
                footer_words.extend(words)
                continue
            if y_max > MAIN_TEXT_Y_MAX:
                continue
            lines.append(words)
        pages.append(
            {
                "pdf_page_number": page_number,
                "display_page_number": extract_display_page_number(footer_words),
                "text": join_pdf_lines(lines),
            }
        )
    return pages


def extract_display_page_number(words: list[str]) -> int | None:
    for word in reversed(words):
        if word.isdigit():
            return int(word)
    return None


def join_pdf_lines(lines: list[list[str]]) -> str:
    parts: list[str] = []
    for words in lines:
        line = " ".join(words)
        if parts and parts[-1].endswith("-"):
            parts[-1] = parts[-1][:-1] + line
        else:
            parts.append(line)
    return " ".join(parts)


def find_page_start(page_norm: str, fixture_norm: str, cursor: int) -> int | None:
    search_start = max(0, cursor - SEARCH_BACKTRACK)
    max_anchor = min(ANCHOR_CHARS, max(MIN_ANCHOR_CHARS, len(page_norm) // 3))
    for anchor_length in (max_anchor, 120, 80, 60, MIN_ANCHOR_CHARS):
        if anchor_length > len(page_norm):
            continue
        max_offset = min(420, len(page_norm) - anchor_length)
        for offset in range(0, max_offset + 1, 20):
            anchor = page_norm[offset : offset + anchor_length]
            match = fixture_norm.find(anchor, search_start)
            if match < 0:
                continue
            estimated_start = match - offset
            if estimated_start < cursor <= match:
                return cursor
            if estimated_start >= search_start:
                return estimated_start
    return None


def make_location(paragraphs: list[dict[str, Any]], mapping: list[tuple[int, int]], norm_offset: int, *, end: bool) -> dict[str, Any]:
    paragraph_index, char_offset = mapping[norm_offset]
    paragraph = paragraphs[paragraph_index]
    return {
        "chapterId": paragraph["chapter_id"],
        "paragraphId": paragraph["paragraph_id"],
        "charOffset": char_offset + (1 if end else 0),
    }


def build_page_map(pdf_path: Path, fixture_path: Path) -> dict[str, Any]:
    paragraphs = load_fixture_paragraphs(fixture_path)
    fixture_norm, mapping = build_normalized_fixture_index(paragraphs)
    pages = extract_pdf_pages(pdf_path)
    page_starts: list[dict[str, Any]] = []
    cursor = 0
    skipped_pages: list[int] = []

    for pdf_page in pages:
        page_norm = normalize_text(pdf_page["text"])
        if len(page_norm) < MIN_PAGE_NORM_CHARS:
            skipped_pages.append(pdf_page["pdf_page_number"])
            continue
        start_norm = find_page_start(page_norm, fixture_norm, cursor)
        if start_norm is None or start_norm >= len(fixture_norm):
            skipped_pages.append(pdf_page["pdf_page_number"])
            continue
        cursor = max(cursor, start_norm + max(MIN_PAGE_NORM_CHARS, len(page_norm) // 2))
        page_starts.append(
            {
                "pdfPageNumber": pdf_page["pdf_page_number"],
                "displayPageNumber": pdf_page["display_page_number"],
                "startNorm": start_norm,
            }
        )

    mapped_pages: list[dict[str, Any]] = []
    for index, page_start in enumerate(page_starts):
        start_norm = page_start["startNorm"]
        end_norm = page_starts[index + 1]["startNorm"] if index + 1 < len(page_starts) else len(fixture_norm)
        if end_norm <= start_norm:
            skipped_pages.append(page_start["pdfPageNumber"])
            continue
        mapped_pages.append(
            {
                "id": f"latex-v13-volume-1-page-{len(mapped_pages) + 1:03d}",
                "pdfPageNumber": page_start["pdfPageNumber"],
                "displayPageNumber": page_start["displayPageNumber"],
                "start": make_location(paragraphs, mapping, start_norm, end=False),
                "end": make_location(paragraphs, mapping, end_norm - 1, end=True),
            }
        )

    return {
        "metadata": {
            "source": "latex_pdf_bbox",
            "workId": "work-szwejk",
            "volumeId": "volume-1",
            "pdfPath": str(pdf_path),
            "fixturePath": str(fixture_path),
            "generatedAt": datetime.now(timezone.utc).isoformat(),
            "pdfPageCount": len(pages),
            "matchedPageCount": len(mapped_pages),
            "skippedPdfPages": skipped_pages,
            "mainTextYMax": MAIN_TEXT_Y_MAX,
            "normalization": "unicode_letters_casefold",
        },
        "pages": mapped_pages,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf", type=Path, default=DEFAULT_PDF)
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    page_map = build_page_map(args.pdf, args.fixture)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(page_map, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Wrote {args.output} with {page_map['metadata']['matchedPageCount']} matched "
        f"pages from {page_map['metadata']['pdfPageCount']} PDF pages"
    )


if __name__ == "__main__":
    main()

import { describe, expect, it } from 'vitest'
import { PAGE_LINE_CAPACITY, buildReaderPages, buildReaderPagesFromPageMap, estimatePageLineCost } from './pagination'
import type { Chapter, Paragraph, ReaderPageMap, Token } from './types'

function makeParagraph(id: string, wordCount: number, footnoteId?: string): Paragraph {
  const words = Array.from({ length: wordCount }, (_, index) => `w${index}`)
  return makeParagraphFromWords(id, words, footnoteId)
}

function makeParagraphFromWords(id: string, words: string[], footnoteId?: string): Paragraph {
  const text = words.join(' ')
  let offset = 0
  const tokens: Token[] = words.map((word, index) => {
    const start = offset
    const end = start + word.length
    offset = end + 1
    return {
      id: `${id}-t-${index}`,
      text: word,
      language: 'pl',
      start,
      end,
      candidateIds: [],
      footnoteIds: index === 0 && footnoteId ? [footnoteId] : undefined,
    }
  })

  return {
    id,
    segments: [
      {
        id: `${id}:hybrid`,
        language: 'hybrid',
        text,
        tokens,
        candidateIds: [],
      },
    ],
  }
}

function makeParagraphWithTextLength(id: string, textLength: number): Paragraph {
  const words: string[] = []
  let currentLength = 0
  while (currentLength < textLength) {
    const nextWord = currentLength % 17 === 0 ? 'Szwejk' : 'melduje'
    const separatorLength = words.length === 0 ? 0 : 1
    if (currentLength + separatorLength + nextWord.length > textLength) break
    words.push(nextWord)
    currentLength += separatorLength + nextWord.length
  }

  return makeParagraphFromWords(id, words)
}

describe('reader pagination', () => {
  it('reserves page line budget for visible footnotes', () => {
    const chapter: Chapter = {
      id: 'chapter-with-footnote',
      title: 'Chapter with footnote',
      paragraphs: [makeParagraph('dense-page-start', 300), makeParagraph('footnoted-tail', 35, 'note-1')],
      candidates: [],
      footnotes: [
        {
          id: 'note-1',
          text: 'krabice — pudełko',
        },
      ],
      glossary: [],
    }

    const pages = buildReaderPages([chapter])
    const footnotedPages = pages.filter((page) => page.footnotes.length > 0)
    const overflowingPages = footnotedPages
      .map((page) => ({
        pageId: page.id,
        lineCost: estimatePageLineCost(page),
        footnoteCount: page.footnotes.length,
      }))
      .filter((page) => page.lineCost > PAGE_LINE_CAPACITY)

    expect(footnotedPages.length).toBeGreaterThan(0)
    expect(overflowingPages).toEqual([])
  })

  it('does not pack the known page 113 dialogue shape into one visual page', () => {
    const chapter: Chapter = {
      id: 'chapter-with-dense-dialogue',
      title: 'Chapter with dense dialogue',
      paragraphs: [
        makeParagraphWithTextLength('opening-fill', 1230),
        makeParagraphWithTextLength('p113-0', 377),
        makeParagraphWithTextLength('p113-1', 266),
        makeParagraphWithTextLength('p113-2', 34),
        makeParagraphWithTextLength('p113-3', 54),
        makeParagraphWithTextLength('p113-4', 55),
        makeParagraphWithTextLength('p113-5', 110),
        makeParagraphWithTextLength('p113-6', 55),
        makeParagraphWithTextLength('p113-7', 58),
        makeParagraphWithTextLength('p113-8', 391),
      ],
      candidates: [],
      footnotes: [],
      glossary: [],
    }

    const pages = buildReaderPages([chapter])
    const dialoguePage = pages.find((page) => page.blocks.some((block) => block.paragraph.id === 'p113-0'))

    expect(dialoguePage?.blocks.map((block) => block.paragraph.id)).not.toContain('p113-8')
  })

  it('keeps a bottom guard for long sliced paragraphs', () => {
    const chapter: Chapter = {
      id: 'chapter-with-long-slice',
      title: 'Chapter with long slice',
      paragraphs: [makeParagraphWithTextLength('opening-fill', 1230), makeParagraphWithTextLength('long-slice', 1212)],
      candidates: [],
      footnotes: [],
      glossary: [],
    }

    const pages = buildReaderPages([chapter])
    const longSlicePage = pages.find((page) => page.blocks.some((block) => block.paragraph.id === 'long-slice'))

    expect(longSlicePage ? estimatePageLineCost(longSlicePage) : 0).toBeLessThanOrEqual(26)
  })

  it('uses LaTeX page-map character ranges when they are available', () => {
    const chapter: Chapter = {
      id: 'chapter-with-map',
      title: 'Chapter with map',
      paragraphs: [makeParagraphFromWords('p-1', ['Alpha', 'bravo', 'charlie']), makeParagraphFromWords('p-2', ['Delta', 'echo', 'foxtrot'])],
      candidates: [],
      footnotes: [],
      glossary: [],
    }
    const pageMap: ReaderPageMap = {
      metadata: {
        source: 'latex_pdf_bbox',
        workId: 'work-szwejk',
        volumeId: 'volume-1',
      },
      pages: [
        {
          id: 'latex-page-1',
          pdfPageNumber: 7,
          displayPageNumber: 3,
          start: { chapterId: 'chapter-with-map', paragraphId: 'p-1', charOffset: 0 },
          end: { chapterId: 'chapter-with-map', paragraphId: 'p-1', charOffset: 11 },
        },
        {
          id: 'latex-page-2',
          pdfPageNumber: 8,
          displayPageNumber: 4,
          start: { chapterId: 'chapter-with-map', paragraphId: 'p-1', charOffset: 12 },
          end: { chapterId: 'chapter-with-map', paragraphId: 'p-2', charOffset: 18 },
        },
      ],
    }

    const pages = buildReaderPagesFromPageMap([chapter], pageMap)

    expect(pages.map((page) => page.displayPageNumber)).toEqual([3, 4])
    expect(pages[0].blocks.map((block) => block.paragraph.segments[0].text)).toEqual(['Alpha bravo'])
    expect(pages[1].blocks.map((block) => block.paragraph.segments[0].text)).toEqual(['charlie', 'Delta echo foxtrot'])
  })

  it('does not synthesize a hyphen when a reference page map slices a word in the middle', () => {
    const chapter: Chapter = {
      id: 'chapter-with-hyphenated-break',
      title: 'Chapter with hyphenated break',
      paragraphs: [makeParagraphFromWords('p-1', ['potem'])],
      candidates: [],
      footnotes: [],
      glossary: [],
    }
    const pageMap: ReaderPageMap = {
      metadata: {
        source: 'latex_pdf_bbox',
        workId: 'work-szwejk',
        volumeId: 'volume-1',
      },
      pages: [
        {
          id: 'latex-page-1',
          pdfPageNumber: 9,
          displayPageNumber: 5,
          start: { chapterId: 'chapter-with-hyphenated-break', paragraphId: 'p-1', charOffset: 0 },
          end: { chapterId: 'chapter-with-hyphenated-break', paragraphId: 'p-1', charOffset: 2 },
        },
        {
          id: 'latex-page-2',
          pdfPageNumber: 10,
          displayPageNumber: 6,
          start: { chapterId: 'chapter-with-hyphenated-break', paragraphId: 'p-1', charOffset: 2 },
          end: { chapterId: 'chapter-with-hyphenated-break', paragraphId: 'p-1', charOffset: 5 },
        },
      ],
    }

    const pages = buildReaderPagesFromPageMap([chapter], pageMap)

    expect(pages[0].blocks[0].paragraph.segments[0].text).toBe('po')
    expect(pages[1].blocks[0].paragraph.segments[0].text).toBe('tem')
  })
})

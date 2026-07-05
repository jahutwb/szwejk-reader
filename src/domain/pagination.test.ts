import { describe, expect, it } from 'vitest'
import { PAGE_LINE_CAPACITY, buildReaderPages, estimatePageLineCost } from './pagination'
import type { Chapter, Paragraph, Token } from './types'

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
})

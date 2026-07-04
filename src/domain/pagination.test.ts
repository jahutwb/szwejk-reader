import { describe, expect, it } from 'vitest'
import { PAGE_LINE_CAPACITY, buildReaderPages, estimatePageLineCost } from './pagination'
import type { Chapter, Paragraph, Token } from './types'

function makeParagraph(id: string, wordCount: number, footnoteId?: string): Paragraph {
  const words = Array.from({ length: wordCount }, (_, index) => `w${index}`)
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
})

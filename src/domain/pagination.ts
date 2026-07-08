import type { Chapter, Footnote, Paragraph, ReaderPageMap, RenderSegment } from './types'

export type ReaderPage = {
  id: string
  chapterId: string
  chapterTitle: string
  isChapterOpening: boolean
  displayPageNumber?: number
  pdfPageNumber?: number
  blocks: ReaderPageBlock[]
  footnotes: Footnote[]
}

export type ReaderPageBlock = {
  id: string
  paragraph: Paragraph
  continuation: boolean
}

export const ESTIMATED_CHARS_PER_LINE = 50
export const PAGE_LINE_CAPACITY = 26
export const MIN_TRAILING_PAGE_LINES = 4
export const CHAPTER_TITLE_LINE_COST = 5

const FOOTNOTE_BLOCK_LINE_COST = 3

export function getReaderSegment(paragraph: Paragraph): RenderSegment | undefined {
  return paragraph.segments.find((segment) => segment.language === 'hybrid') ?? paragraph.segments.find((segment) => segment.language === 'pl') ?? paragraph.segments[0]
}

export function estimateTextLineCost(text: string): number {
  const compactLength = text.replace(/\s+/g, ' ').trim().length
  return Math.max(1, Math.ceil(compactLength / ESTIMATED_CHARS_PER_LINE))
}

export function estimateParagraphLineCost(paragraph: Paragraph): number {
  const readerSegment = getReaderSegment(paragraph)
  return estimateTextLineCost(readerSegment?.text ?? '')
}

export function estimateFootnoteLineCost(footnotes: Footnote[]): number {
  if (footnotes.length === 0) return 0
  return FOOTNOTE_BLOCK_LINE_COST + footnotes.reduce((total, footnote) => total + estimateTextLineCost(footnote.text), 0)
}

export function estimatePageLineCost(page: Pick<ReaderPage, 'blocks' | 'footnotes' | 'isChapterOpening'>): number {
  return estimateContentLineCost(page.blocks, page.isChapterOpening) + estimateFootnoteLineCost(page.footnotes)
}

function estimateContentLineCost(blocks: ReaderPageBlock[], isChapterOpening: boolean): number {
  const titleCost = isChapterOpening ? CHAPTER_TITLE_LINE_COST : 0
  return titleCost + blocks.reduce((total, block) => total + estimateParagraphLineCost(block.paragraph), 0)
}

function findSliceEnd(segment: RenderSegment, start: number, lineCapacity: number): number {
  const textLength = segment.text.length
  const capacity = Math.max(lineCapacity, MIN_TRAILING_PAGE_LINES) * ESTIMATED_CHARS_PER_LINE
  if (start + capacity >= textLength) return textLength
  const target = start + capacity
  const minTrailingChars = MIN_TRAILING_PAGE_LINES * ESTIMATED_CHARS_PER_LINE
  const candidates = segment.tokens.filter((token) => token.end <= target && token.end > start + minTrailingChars)
  if (candidates.length > 0) return candidates[candidates.length - 1].end
  const fallback = segment.tokens.find((token) => token.end > start)
  return fallback?.end ?? textLength
}

export function sliceParagraph(paragraph: Paragraph, start: number, end: number): Paragraph {
  const segment = getReaderSegment(paragraph)
  if (!segment) return paragraph
  const text = segment.text.slice(start, end)
  const tokens = segment.tokens
    .filter((token) => token.start >= start && token.end <= end)
    .map((token) => ({
      ...token,
      start: token.start - start,
      end: token.end - start,
    }))
  const candidateIds = Array.from(new Set(tokens.flatMap((token) => token.candidateIds)))
  return {
    ...paragraph,
    segments: [
      {
        ...segment,
        id: `${segment.id}::slice:${start}:${end}`,
        text,
        tokens,
        candidateIds,
      },
    ],
  }
}

function collectBlockFootnotes(block: ReaderPageBlock, footnoteById: Map<string, Footnote>): Footnote[] {
  const footnotes: Footnote[] = []
  const seen = new Set<string>()
  const segment = getReaderSegment(block.paragraph)
  for (const token of segment?.tokens ?? []) {
    for (const footnoteId of token.footnoteIds ?? []) {
      if (seen.has(footnoteId)) continue
      const footnote = footnoteById.get(footnoteId)
      if (!footnote) continue
      seen.add(footnoteId)
      footnotes.push(footnote)
    }
  }
  return footnotes
}

function makePageBlock(paragraph: Paragraph, sliceIndex: number, start: number, end: number): ReaderPageBlock {
  return {
    id: `${paragraph.id}:page-slice:${sliceIndex}:${start}:${end}`,
    paragraph: sliceParagraph(paragraph, start, end),
    continuation: start > 0,
  }
}

function estimateNewFootnoteLineCost(footnotes: Footnote[], seenFootnoteIds: Set<string>, hasPageFootnotes: boolean): number {
  const newFootnotes = footnotes.filter((footnote) => !seenFootnoteIds.has(footnote.id))
  if (newFootnotes.length === 0) return 0
  const blockCost = hasPageFootnotes ? 0 : FOOTNOTE_BLOCK_LINE_COST
  return blockCost + newFootnotes.reduce((total, footnote) => total + estimateTextLineCost(footnote.text), 0)
}

export function buildReaderPages(chapters: Chapter[]): ReaderPage[] {
  const pages: ReaderPage[] = []
  for (const chapter of chapters) {
    const footnoteById = new Map(chapter.footnotes.map((footnote) => [footnote.id, footnote]))
    let current: ReaderPageBlock[] = []
    let currentContentLineCost = 0
    let currentFootnoteLineCost = 0
    let currentFootnotes: Footnote[] = []
    let currentFootnoteIds = new Set<string>()
    let pageIndexInChapter = 1

    const getCurrentCost = () => {
      const titleCost = pageIndexInChapter === 1 ? CHAPTER_TITLE_LINE_COST : 0
      return titleCost + currentContentLineCost + currentFootnoteLineCost
    }

    const resetCurrent = () => {
      current = []
      currentContentLineCost = 0
      currentFootnoteLineCost = 0
      currentFootnotes = []
      currentFootnoteIds = new Set<string>()
    }

    const pushPage = () => {
      if (current.length === 0) return
      const nextPageIndex = pageIndexInChapter
      pages.push({
        id: `${chapter.id}-page-${nextPageIndex}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        isChapterOpening: nextPageIndex === 1,
        blocks: current,
        footnotes: currentFootnotes,
      })
      resetCurrent()
      pageIndexInChapter += 1
    }

    const addBlock = (block: ReaderPageBlock, blockLineCost: number, blockFootnotes: Footnote[]) => {
      current.push(block)
      currentContentLineCost += blockLineCost
      currentFootnoteLineCost += estimateNewFootnoteLineCost(blockFootnotes, currentFootnoteIds, currentFootnotes.length > 0)
      for (const footnote of blockFootnotes) {
        if (currentFootnoteIds.has(footnote.id)) continue
        currentFootnoteIds.add(footnote.id)
        currentFootnotes.push(footnote)
      }
    }

    for (const paragraph of chapter.paragraphs) {
      const segment = getReaderSegment(paragraph)
      if (!segment) continue
      let start = 0
      let sliceIndex = 0
      let sliceGuard = 0
      while (start < segment.text.length) {
        sliceGuard += 1
        if (sliceGuard > 1000) {
          throw new Error(`Pagination did not converge for paragraph ${paragraph.id}`)
        }
        const isChapterOpening = pageIndexInChapter === 1
        const currentCost = getCurrentCost()
        if (current.length > 0 && PAGE_LINE_CAPACITY - currentCost < MIN_TRAILING_PAGE_LINES) {
          pushPage()
          continue
        }

        const remaining = PAGE_LINE_CAPACITY - currentCost
        let end = findSliceEnd(segment, start, Math.max(remaining, MIN_TRAILING_PAGE_LINES))
        let nextBlock = makePageBlock(paragraph, sliceIndex, start, end)
        let nextBlockLineCost = estimateParagraphLineCost(nextBlock.paragraph)
        let nextBlockFootnotes = collectBlockFootnotes(nextBlock, footnoteById)
        let candidateCost =
          currentCost + nextBlockLineCost + estimateNewFootnoteLineCost(nextBlockFootnotes, currentFootnoteIds, currentFootnotes.length > 0)

        if (candidateCost > PAGE_LINE_CAPACITY && current.length > 0) {
          pushPage()
          continue
        }

        if (candidateCost > PAGE_LINE_CAPACITY) {
          const reservedFootnoteLines = estimateNewFootnoteLineCost(nextBlockFootnotes, currentFootnoteIds, currentFootnotes.length > 0)
          const titleLines = isChapterOpening ? CHAPTER_TITLE_LINE_COST : 0
          const adjustedCapacity = Math.max(PAGE_LINE_CAPACITY - titleLines - reservedFootnoteLines, MIN_TRAILING_PAGE_LINES)
          const adjustedEnd = findSliceEnd(segment, start, adjustedCapacity)
          if (adjustedEnd > start && adjustedEnd < end) {
            end = adjustedEnd
            nextBlock = makePageBlock(paragraph, sliceIndex, start, end)
            nextBlockLineCost = estimateParagraphLineCost(nextBlock.paragraph)
            nextBlockFootnotes = collectBlockFootnotes(nextBlock, footnoteById)
            candidateCost =
              getCurrentCost() + nextBlockLineCost + estimateNewFootnoteLineCost(nextBlockFootnotes, currentFootnoteIds, currentFootnotes.length > 0)
          }
        }

        if (end <= start) {
          throw new Error(`Pagination slice did not advance for paragraph ${paragraph.id}`)
        }
        addBlock(nextBlock, nextBlockLineCost, nextBlockFootnotes)
        start = end
        sliceIndex += 1
        while (start < segment.text.length && /\s/.test(segment.text[start])) {
          start += 1
        }
        if (start < segment.text.length && candidateCost >= PAGE_LINE_CAPACITY) {
          pushPage()
        }
      }
    }

    pushPage()
  }

  return pages
}

export function buildReaderPagesFromPageMap(chapters: Chapter[], pageMap: ReaderPageMap): ReaderPage[] {
  const chapterById = new Map(chapters.map((chapter) => [chapter.id, chapter]))
  const paragraphOrder = new Map<string, { chapter: Chapter; paragraph: Paragraph; order: number }>()
  const seenChapterIds = new Set<string>()
  let order = 0
  for (const chapter of chapters) {
    for (const paragraph of chapter.paragraphs) {
      paragraphOrder.set(paragraph.id, { chapter, paragraph, order })
      order += 1
    }
  }

  const pages: ReaderPage[] = []
  for (const entry of pageMap.pages) {
    const startRecord = paragraphOrder.get(entry.start.paragraphId)
    const endRecord = paragraphOrder.get(entry.end.paragraphId)
    if (!startRecord || !endRecord || startRecord.order > endRecord.order) continue
    const blocks: ReaderPageBlock[] = []
    for (const record of paragraphOrder.values()) {
      if (record.order < startRecord.order || record.order > endRecord.order) continue
      const segment = getReaderSegment(record.paragraph)
      if (!segment) continue
      const sliceStart = record.order === startRecord.order ? entry.start.charOffset : 0
      const sliceEnd = record.order === endRecord.order ? entry.end.charOffset : segment.text.length
      if (sliceEnd <= sliceStart) continue
      blocks.push({
        id: `${record.paragraph.id}:latex-page:${entry.pdfPageNumber}:${sliceStart}:${sliceEnd}`,
        paragraph: sliceParagraph(record.paragraph, sliceStart, sliceEnd),
        continuation: sliceStart > 0,
      })
    }
    if (blocks.length === 0) continue
    const chapter = chapterById.get(entry.start.chapterId) ?? startRecord.chapter
    const isChapterOpening = !seenChapterIds.has(chapter.id)
    seenChapterIds.add(chapter.id)
    pages.push({
      id: entry.id,
      chapterId: chapter.id,
      chapterTitle: chapter.title,
      isChapterOpening,
      displayPageNumber: entry.displayPageNumber,
      pdfPageNumber: entry.pdfPageNumber,
      blocks,
      footnotes: collectPageFootnotesForBlocks(chapter, blocks),
    })
  }

  return pages.length > 0 ? pages : buildReaderPages(chapters)
}

export function collectPageFootnotesForBlocks(chapter: Chapter, blocks: ReaderPageBlock[]): Footnote[] {
  const footnoteById = new Map(chapter.footnotes.map((footnote) => [footnote.id, footnote]))
  const seen = new Set<string>()
  const footnotes: Footnote[] = []
  for (const block of blocks) {
    for (const footnote of collectBlockFootnotes(block, footnoteById)) {
      if (seen.has(footnote.id)) continue
      seen.add(footnote.id)
      footnotes.push(footnote)
    }
  }
  return footnotes
}

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from 'react'
import { BookOpen, Bug, ChevronLeft, ChevronRight, Download, Lock, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadMiniFixture } from '@/data/fixture'
import { findSmallestCandidateForToken } from '@/domain/selection'
import { splitTokenTextParts } from '@/domain/textSegments'
import type { Candidate, Chapter, Footnote, Paragraph, ReaderFixture, ReaderOverride, RenderSegment, Token, Volume } from '@/domain/types'
import { logCorrectionEvent, logWordClick, submitOverrides } from '@/telemetry/telemetry'
import { cn } from '@/lib/utils'

type View = 'library' | 'reader'

type TokenSelection = {
  token: Token
  paragraph: Paragraph
  chapterId: string
  segmentId: string
  candidateIds: string[]
  candidateOptions: Candidate[]
  activeCandidate?: Candidate
  anchor?: {
    x: number
    y: number
  }
}

type ReaderPage = {
  id: string
  chapterId: string
  chapterTitle: string
  isChapterOpening: boolean
  blocks: ReaderPageBlock[]
  footnotes: Footnote[]
}

type ReaderPageBlock = {
  id: string
  paragraph: Paragraph
  continuation: boolean
}

type ReaderProgress = {
  workId: string
  volumeId: string
  chapterId: string
  paragraphId: string
  segmentId?: string
  tokenId?: string
  updatedAt: string
}

const FIXTURE_VOLUME_ID = 'volume-1'
const PROGRESS_KEY = 'szwejk-reader.progress'
const OVERRIDES_KEY = 'szwejk-reader.overrides'
const PAGE_CHAR_CAPACITY = 1650
const MIN_TRAILING_PAGE_CHARS = 260
const CHAPTER_TITLE_CHAR_COST = 360

const defaultVolumes: Volume[] = [
  { id: 'volume-1', label: 'Tom I', status: 'available', chapters: [] },
  { id: 'volume-2', label: 'Tom II', status: 'locked', chapters: [] },
  { id: 'volume-3', label: 'Tom III', status: 'soon', chapters: [] },
  { id: 'volume-4', label: 'Tom IV', status: 'soon', chapters: [] },
]

function readOverrides(): ReaderOverride[] {
  try {
    return JSON.parse(localStorage.getItem(OVERRIDES_KEY) ?? '[]') as ReaderOverride[]
  } catch {
    return []
  }
}

function writeOverrides(overrides: ReaderOverride[]): void {
  localStorage.setItem(OVERRIDES_KEY, JSON.stringify(overrides))
}

function readProgress(): ReaderProgress | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(PROGRESS_KEY) ?? 'null') as ReaderProgress | null
    return parsed?.paragraphId ? parsed : null
  } catch {
    return null
  }
}

function getAvailableVolume(fixture: ReaderFixture | null): Volume | undefined {
  return fixture?.work.volumes.find((volume) => volume.id === FIXTURE_VOLUME_ID)
}

function getAvailableChapters(fixture: ReaderFixture | null): Chapter[] {
  return getAvailableVolume(fixture)?.chapters ?? []
}

function getReaderSegment(paragraph: Paragraph) {
  return paragraph.segments.find((segment) => segment.language === 'hybrid') ?? paragraph.segments.find((segment) => segment.language === 'pl') ?? paragraph.segments[0]
}

function estimateParagraphLength(paragraph: Paragraph): number {
  const readerSegment = getReaderSegment(paragraph)
  return readerSegment?.text.length ?? 0
}

function findSliceEnd(segment: RenderSegment, start: number, capacity: number): number {
  const textLength = segment.text.length
  if (start + capacity >= textLength) return textLength
  const target = start + capacity
  const candidates = segment.tokens.filter((token) => token.end <= target && token.end > start + MIN_TRAILING_PAGE_CHARS)
  if (candidates.length > 0) return candidates[candidates.length - 1].end
  const fallback = segment.tokens.find((token) => token.end > start)
  return fallback?.end ?? textLength
}

function sliceParagraph(paragraph: Paragraph, start: number, end: number): Paragraph {
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

function collectPageFootnotes(chapter: Chapter, blocks: ReaderPageBlock[]): Footnote[] {
  const byId = new Map(chapter.footnotes.map((footnote) => [footnote.id, footnote]))
  const seen = new Set<string>()
  const footnotes: Footnote[] = []
  for (const block of blocks) {
    const segment = getReaderSegment(block.paragraph)
    for (const token of segment?.tokens ?? []) {
      for (const footnoteId of token.footnoteIds ?? []) {
        if (seen.has(footnoteId)) continue
        const footnote = byId.get(footnoteId)
        if (!footnote) continue
        seen.add(footnoteId)
        footnotes.push(footnote)
      }
    }
  }
  return footnotes
}

function buildReaderPages(chapters: Chapter[]): ReaderPage[] {
  const pages: ReaderPage[] = []
  for (const chapter of chapters) {
    let current: ReaderPageBlock[] = []
    let currentLength = CHAPTER_TITLE_CHAR_COST
    let pageIndexInChapter = 1

    const pushPage = () => {
      if (current.length === 0) return
      const nextPageIndex = pageIndexInChapter
      pages.push({
        id: `${chapter.id}-page-${nextPageIndex}`,
        chapterId: chapter.id,
        chapterTitle: chapter.title,
        isChapterOpening: nextPageIndex === 1,
        blocks: current,
        footnotes: collectPageFootnotes(chapter, current),
      })
      current = []
      currentLength = 0
      pageIndexInChapter += 1
    }

    for (const paragraph of chapter.paragraphs) {
      const segment = getReaderSegment(paragraph)
      if (!segment) continue
      let start = 0
      let sliceIndex = 0
      while (start < segment.text.length) {
        if (current.length > 0 && PAGE_CHAR_CAPACITY - currentLength < MIN_TRAILING_PAGE_CHARS) {
          pushPage()
        }
        const remaining = PAGE_CHAR_CAPACITY - currentLength
        const end = findSliceEnd(segment, start, Math.max(remaining, MIN_TRAILING_PAGE_CHARS))
        const sliced = sliceParagraph(paragraph, start, end)
        const slicedLength = estimateParagraphLength(sliced)
        current.push({
          id: `${paragraph.id}:page-slice:${sliceIndex}:${start}:${end}`,
          paragraph: sliced,
          continuation: start > 0,
        })
        currentLength += slicedLength
        start = end
        sliceIndex += 1
        while (start < segment.text.length && /\s/.test(segment.text[start])) {
          start += 1
        }
        if (start < segment.text.length && currentLength >= PAGE_CHAR_CAPACITY) {
          pushPage()
        }
      }
    }

    pushPage()
  }

  return pages
}

function getCandidateOptionsForToken(candidates: Candidate[], token: Token): Candidate[] {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]))
  const options = token.candidateIds.map((candidateId) => byId.get(candidateId)).filter((candidate): candidate is Candidate => Boolean(candidate))
  options.sort((left, right) => {
    const leftSpan = (left.sourceEnd ?? left.tokenIds.length) - (left.sourceStart ?? 0)
    const rightSpan = (right.sourceEnd ?? right.tokenIds.length) - (right.sourceStart ?? 0)
    if (leftSpan !== rightSpan) return leftSpan - rightSpan
    return (right.depth ?? 0) - (left.depth ?? 0)
  })
  if (options.length > 0) return options
  const fallback = findSmallestCandidateForToken(candidates, token.id)
  return fallback ? [fallback] : []
}

function downloadJson(filename: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2)
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

function getDebugMode(): boolean {
  return new URLSearchParams(window.location.search).get('debug') === '1'
}

function App() {
  const [view, setView] = useState<View>('library')
  const [fixture, setFixture] = useState<ReaderFixture | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [selection, setSelection] = useState<TokenSelection | null>(null)
  const [overrides, setOverrides] = useState<ReaderOverride[]>(() => readOverrides())
  const [currentLocation, setCurrentLocation] = useState<ReaderProgress | null>(() => readProgress())
  const [currentPageIndex, setCurrentPageIndex] = useState(0)
  const [tocOpen, setTocOpen] = useState(false)

  const debugMode = useMemo(() => getDebugMode(), [])
  const work = fixture?.work
  const volumes = work?.volumes ?? defaultVolumes
  const availableChapters = useMemo(() => getAvailableChapters(fixture), [fixture])
  const firstChapter = availableChapters[0]
  const chapterById = useMemo(() => new Map(availableChapters.map((chapter) => [chapter.id, chapter])), [availableChapters])
  const pages = useMemo(() => buildReaderPages(availableChapters), [availableChapters])
  const resolvedPageIndex = useMemo(() => {
    if (pages.length === 0) return 0
    const segmentId = currentLocation?.segmentId
    if (segmentId) {
      const indexFromSegment = pages.findIndex((page) => page.blocks.some((block) => getReaderSegment(block.paragraph)?.id === segmentId))
      if (indexFromSegment >= 0) return indexFromSegment
    }
    const paragraphId = currentLocation?.paragraphId
    if (paragraphId) {
      const indexFromLocation = pages.findIndex((page) => page.blocks.some((block) => block.paragraph.id === paragraphId))
      if (indexFromLocation >= 0) return indexFromLocation
    }
    return Math.min(currentPageIndex, pages.length - 1)
  }, [currentLocation?.paragraphId, currentLocation?.segmentId, currentPageIndex, pages])
  const currentPage = pages[resolvedPageIndex]
  const pageCount = Math.max(pages.length, 1)

  useEffect(() => {
    let alive = true
    loadMiniFixture()
      .then((loaded) => {
        if (!alive) return
        setFixture(loaded)
        setLoadError(null)
      })
      .catch((error: unknown) => {
        if (!alive) return
        setLoadError(error instanceof Error ? error.message : String(error))
      })
    return () => {
      alive = false
    }
  }, [])

  const writeProgress = useCallback(
    (progress: Omit<ReaderProgress, 'workId' | 'volumeId' | 'updatedAt'>) => {
      const nextProgress: ReaderProgress = {
        workId: work?.id ?? 'work-szwejk',
        volumeId: FIXTURE_VOLUME_ID,
        ...progress,
        updatedAt: new Date().toISOString(),
      }
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(nextProgress))
      setCurrentLocation(nextProgress)
    },
    [work?.id],
  )

  const goToPage = useCallback(
    (nextIndex: number) => {
      if (!pages.length) return
      const boundedIndex = Math.min(Math.max(nextIndex, 0), pages.length - 1)
      const nextPage = pages[boundedIndex]
      const firstParagraph = nextPage.blocks[0]?.paragraph
      const firstSegment = firstParagraph ? getReaderSegment(firstParagraph) : undefined
      setCurrentPageIndex(boundedIndex)
      setSelection(null)
      setTocOpen(false)
      if (firstParagraph) {
        writeProgress({
          chapterId: nextPage.chapterId,
          paragraphId: firstParagraph.id,
          segmentId: firstSegment?.id,
          tokenId: firstSegment?.tokens[0]?.id,
        })
      }
    },
    [pages, writeProgress],
  )

  const goToChapter = useCallback(
    (chapterId: string) => {
      const nextIndex = pages.findIndex((page) => page.chapterId === chapterId)
      if (nextIndex >= 0) goToPage(nextIndex)
    },
    [goToPage, pages],
  )

  const closeReaderOverlays = useCallback(() => {
    setSelection(null)
    setTocOpen(false)
  }, [])

  useEffect(() => {
    if (view !== 'reader') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goToPage(resolvedPageIndex - 1)
      if (event.key === 'ArrowRight') goToPage(resolvedPageIndex + 1)
      if (event.key === 'Escape') closeReaderOverlays()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [closeReaderOverlays, goToPage, resolvedPageIndex, view])

  function openReader() {
    setView('reader')
  }

  function handleTokenClick(chapterId: string, paragraph: Paragraph, segmentId: string, token: Token, anchor?: DOMRect) {
    const chapter = chapterById.get(chapterId)
    if (!chapter) return
    const candidateOptions = getCandidateOptionsForToken(chapter.candidates, token)
    const activeCandidate = candidateOptions[0] ?? findSmallestCandidateForToken(chapter.candidates, token.id)
    const nextSelection = {
      token,
      paragraph,
      chapterId,
      segmentId,
      candidateIds: token.candidateIds,
      candidateOptions,
      activeCandidate,
      anchor: anchor
        ? {
            x: Math.min(Math.max(anchor.left + anchor.width / 2, 144), window.innerWidth - 144),
            y: Math.max(anchor.top, 72),
          }
        : undefined,
    }
    setSelection(nextSelection)
    writeProgress({
      chapterId,
      paragraphId: paragraph.id,
      segmentId,
      tokenId: token.id,
    })
    logWordClick({
      workId: work?.id ?? 'work-szwejk',
      volumeId: FIXTURE_VOLUME_ID,
      chapterId,
      paragraphId: paragraph.id,
      tokenId: token.id,
      tokenText: token.text,
      language: token.language,
      candidateIds: token.candidateIds,
      activeCandidateId: activeCandidate?.id,
    })
  }

  function selectCandidate(candidate: Candidate) {
    setSelection((current) => (current ? { ...current, activeCandidate: candidate } : current))
  }

  async function saveDebugOverride() {
    if (!selection) return
    const override: ReaderOverride = {
      id: `override-${Date.now()}`,
      workId: work?.id ?? 'work-szwejk',
      volumeId: FIXTURE_VOLUME_ID,
      chapterId: selection.chapterId,
      baseArtifactId: fixture?.metadata.sourceArtifactId,
      createdAt: new Date().toISOString(),
      operations: [
        {
          type: 'debug-token-note',
          tokenId: selection.token.id,
          candidateId: selection.activeCandidate?.id,
          paragraphId: selection.paragraph.id,
          value: { tokenText: selection.token.text, language: selection.token.language },
        },
      ],
    }
    const next = [...overrides, override]
    setOverrides(next)
    writeOverrides(next)
    logCorrectionEvent({
      workId: override.workId,
      volumeId: override.volumeId,
      chapterId: override.chapterId,
      eventType: 'debug_override_saved',
      candidateId: selection.activeCandidate?.id,
      tokenId: selection.token.id,
    })
    await submitOverrides(next)
  }

  const exportOverrides = () => downloadJson('szwejk-reader-overrides.json', overrides)

  if (view === 'reader') {
    const canGoBack = resolvedPageIndex > 0
    const canGoForward = resolvedPageIndex < pages.length - 1
    const currentChapterTitle = currentPage?.chapterTitle ?? firstChapter?.title ?? 'Rozdział 1'

    return (
      <main className="reader-view text-foreground" data-testid="reader-screen" onClick={closeReaderOverlays}>
        {loadError ? <p className="reader-error">{loadError}</p> : null}

        <section className={cn('reader-stage', debugMode && 'reader-stage-debug')}>
          <article
            className="reader-page-frame"
            aria-label={`Strona ${resolvedPageIndex + 1} z ${pageCount}`}
            data-testid="reader-page-frame"
            onClick={closeReaderOverlays}
          >
            <div className="reader-page-head" onClick={(event) => event.stopPropagation()}>
              <nav className="reader-breadcrumb" aria-label="Ścieżka czytania">
                <button className="reader-crumb-button" type="button" onClick={() => setView('library')}>
                  Biblioteczka
                </button>
                <span aria-hidden="true">&gt;</span>
                <span>Dobry wojak Szwejk</span>
                <span aria-hidden="true">&gt;</span>
                <span>Tom I</span>
                <span aria-hidden="true">&gt;</span>
                <button
                  className="reader-crumb-button reader-chapter-trigger"
                  type="button"
                  aria-expanded={tocOpen}
                  aria-label={`Spis treści: ${currentChapterTitle}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    setSelection(null)
                    setTocOpen((open) => !open)
                  }}
                >
                  {currentChapterTitle}
                </button>
              </nav>
              {debugMode ? (
                <span className="debug-pill">
                  <Bug className="h-3.5 w-3.5" />
                  debug
                </span>
              ) : null}
              {tocOpen ? (
                <TableOfContents
                  chapters={availableChapters}
                  currentChapterId={currentPage?.chapterId}
                  onSelectChapter={(chapterId) => {
                    goToChapter(chapterId)
                  }}
                />
              ) : null}
            </div>

            <div className="reader-page-content">
              {currentPage?.isChapterOpening ? <ChapterTitle chapter={chapterById.get(currentPage.chapterId)} /> : null}
              {currentPage
                ? currentPage.blocks.map((block) => (
                    <ReaderParagraph
                      key={block.id}
                      paragraph={block.paragraph}
                      workId={work?.id ?? 'work-szwejk'}
                      chapterId={currentPage.chapterId}
                      continuation={block.continuation}
                      footnoteNumberById={new Map(currentPage.footnotes.map((footnote, index) => [footnote.id, index + 1]))}
                      selection={selection}
                      onTokenClick={handleTokenClick}
                    />
                  ))
                : null}
            </div>

            <ReaderPopover selection={selection} onSelectCandidate={selectCandidate} />

            {currentPage?.footnotes.length ? <PageFootnotes footnotes={currentPage.footnotes} /> : null}

            <div className="reader-page-foot" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="sm" onClick={() => goToPage(resolvedPageIndex - 1)} disabled={!canGoBack} aria-label="Poprzednia strona">
                <ChevronLeft className="h-4 w-4" />
                Poprzednia
              </Button>
              <span className="reader-page-number tabular-nums" data-testid="reader-page-number">
                {resolvedPageIndex + 1}
              </span>
              <Button variant="ghost" size="sm" onClick={() => goToPage(resolvedPageIndex + 1)} disabled={!canGoForward} aria-label="Następna strona">
                Następna
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </article>

          {debugMode ? (
            <DebugPanel
              selection={selection}
              overridesCount={overrides.length}
              onSaveOverride={saveDebugOverride}
              onExportOverrides={exportOverrides}
            />
          ) : null}
        </section>
      </main>
    )
  }

  return (
    <main className="library-view text-foreground">
      <div className="mx-auto max-w-6xl">
        <header className="library-header">
          <p>Hybrydowe wydanie PL {'->'} CS</p>
          <h1>Biblioteczka</h1>
        </header>

        <section className="library-book">
          <div className="library-cover" aria-hidden="true">
            <BookOpen className="h-10 w-10" />
          </div>
          <div className="library-copy">
            <h2>Dobry wojak Szwejk</h2>
            <p>Publiczny czytnik tomu I. Kliknij słowo w tekście, żeby zobaczyć równoległy fragment zaraz przy zaznaczeniu.</p>
            {loadError ? <p className="reader-error">{loadError}</p> : null}
            <Button onClick={openReader} disabled={!fixture || !firstChapter}>
              <BookOpen className="h-4 w-4" />
              Czytaj Tom I
            </Button>
          </div>
          <div className="volume-grid">
            {volumes.map((volume) => (
              <VolumeTile key={volume.id} volume={volume} />
            ))}
          </div>
        </section>
      </div>
    </main>
  )
}

function ChapterTitle({ chapter }: { chapter?: Chapter }) {
  if (!chapter) return null
  const titlePl = chapter.titlePl || chapter.title
  const titleCs = chapter.titleCs || titlePl
  const plStyle = chapter.titleSizesPt?.pl ? ({ fontSize: chapter.titleSizesPt.pl } satisfies CSSProperties) : undefined
  const csStyle = chapter.titleSizesPt?.cs ? ({ fontSize: chapter.titleSizesPt.cs } satisfies CSSProperties) : undefined

  return (
    <h2 className="chapter-title" aria-label={`${titlePl} ${titleCs}`}>
      <span className="chapter-title-pl" style={plStyle}>
        {titlePl}
      </span>
      <span className="chapter-title-cs" lang="cs" style={csStyle}>
        {titleCs}
      </span>
    </h2>
  )
}

function TableOfContents({
  chapters,
  currentChapterId,
  onSelectChapter,
}: {
  chapters: Chapter[]
  currentChapterId?: string
  onSelectChapter: (chapterId: string) => void
}) {
  return (
    <aside className="reader-toc-popover" role="dialog" aria-label="Spis treści" onClick={(event) => event.stopPropagation()}>
      <ol className="reader-toc-list">
        {chapters.map((chapter, index) => (
          <li key={chapter.id}>
            <button
              type="button"
              className={cn(chapter.id === currentChapterId && 'reader-toc-current')}
              aria-current={chapter.id === currentChapterId ? 'location' : undefined}
              onClick={() => onSelectChapter(chapter.id)}
            >
              <span className="tabular-nums">{index + 1}</span>
              <span>{chapter.title}</span>
            </button>
          </li>
        ))}
      </ol>
    </aside>
  )
}

function ReaderParagraph({
  paragraph,
  workId,
  chapterId,
  continuation,
  footnoteNumberById,
  selection,
  onTokenClick,
}: {
  paragraph: Paragraph
  workId: string
  chapterId: string
  continuation: boolean
  footnoteNumberById: Map<string, number>
  selection: TokenSelection | null
  onTokenClick: (chapterId: string, paragraph: Paragraph, segmentId: string, token: Token, anchor?: DOMRect) => void
}) {
  const segment = getReaderSegment(paragraph)
  if (!segment) return null
  const parts = splitTokenTextParts(segment)

  return (
    <p
      className={cn('reader-paragraph', continuation && 'reader-paragraph-continuation')}
      lang={segment.language}
      data-work-id={workId}
      data-volume-id={FIXTURE_VOLUME_ID}
      data-chapter-id={chapterId}
      data-paragraph-id={paragraph.id}
      data-segment-id={segment.id}
      data-candidate-ids={segment.candidateIds.join(' ')}
    >
      {parts.map((part) => {
        if (part.kind === 'text') {
          return <span key={part.key}>{part.text}</span>
        }
        const token = part.token
        const activeRange = selection?.activeCandidate?.tokenIds.includes(token.id)
        const clicked = selection?.token.id === token.id
        return (
          <span
            key={part.key}
            role="button"
            tabIndex={0}
            data-testid="reader-token"
            className={cn('reader-token', token.language === 'cs' && 'reader-token-target', activeRange && 'reader-token-active', clicked && 'reader-token-clicked')}
            onClick={(event) => {
              event.stopPropagation()
              onTokenClick(chapterId, paragraph, segment.id, token, event.currentTarget.getBoundingClientRect())
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                event.stopPropagation()
                onTokenClick(chapterId, paragraph, segment.id, token, event.currentTarget.getBoundingClientRect())
              }
            }}
            data-work-id={workId}
            data-volume-id={FIXTURE_VOLUME_ID}
            data-chapter-id={chapterId}
            data-paragraph-id={paragraph.id}
            data-segment-id={segment.id}
            data-token-id={token.id}
            data-candidate-ids={token.candidateIds.join(' ')}
            data-intro-ids={(token.introIds ?? []).join(' ')}
            data-footnote-ids={(token.footnoteIds ?? []).join(' ')}
            lang={token.language === 'cs' ? 'cs' : undefined}
          >
            <TokenText token={token} text={part.text} footnoteNumberById={footnoteNumberById} />
          </span>
        )
      })}
    </p>
  )
}

function TokenText({ token, text, footnoteNumberById }: { token: Token; text: string; footnoteNumberById: Map<string, number> }) {
  const ranges = token.introRanges ?? []
  const footnoteNumbers = Array.from(new Set((token.footnoteIds ?? []).map((id) => footnoteNumberById.get(id)).filter((value): value is number => Boolean(value))))
  if (!ranges.length) {
    return (
      <>
        {text}
        {footnoteNumbers.map((number) => (
          <sup key={number} className="reader-note-ref">
            {number}
          </sup>
        ))}
      </>
    )
  }

  const parts: Array<{ text: string; intro: boolean; key: string }> = []
  let cursor = 0
  for (const [index, range] of ranges.entries()) {
    const start = Math.max(0, Math.min(text.length, range.start))
    const end = Math.max(start, Math.min(text.length, range.end))
    if (cursor < start) {
      parts.push({ key: `plain-${index}-${cursor}`, text: text.slice(cursor, start), intro: false })
    }
    if (start < end) {
      parts.push({ key: `intro-${index}-${start}`, text: text.slice(start, end), intro: true })
    }
    cursor = end
  }
  if (cursor < text.length) {
    parts.push({ key: `plain-tail-${cursor}`, text: text.slice(cursor), intro: false })
  }

  return (
    <>
      {parts.map((part) =>
        part.intro ? (
          <span key={part.key} className="lemma-intro">
            {part.text}
          </span>
        ) : (
          <span key={part.key}>{part.text}</span>
        ),
      )}
      {footnoteNumbers.map((number) => (
        <sup key={number} className="reader-note-ref">
          {number}
        </sup>
      ))}
    </>
  )
}

function PageFootnotes({ footnotes }: { footnotes: Footnote[] }) {
  return (
    <ol className="reader-page-notes">
      {footnotes.map((footnote, index) => (
        <li key={footnote.id}>
          <span>{index + 1}</span>
          <p>{footnote.text}</p>
        </li>
      ))}
    </ol>
  )
}

function ReaderPopover({
  selection,
  onSelectCandidate,
}: {
  selection: TokenSelection | null
  onSelectCandidate: (candidate: Candidate) => void
}) {
  if (!selection) return null
  const candidate = selection.activeCandidate
  const counterpart = selection.token.language === 'pl' ? candidate?.targetText : candidate?.sourceText
  const activeIndex = Math.max(
    0,
    selection.candidateOptions.findIndex((option) => option.id === candidate?.id),
  )
  const canShrink = activeIndex > 0
  const canExpand = activeIndex >= 0 && activeIndex < selection.candidateOptions.length - 1
  const style = selection.anchor
    ? ({
        left: `${selection.anchor.x}px`,
        top: `${selection.anchor.y}px`,
      } satisfies CSSProperties)
    : undefined

  return (
    <aside className="reader-popover" role="dialog" aria-label="Równoległy tekst" style={style} onClick={(event) => event.stopPropagation()}>
      <blockquote lang={selection.token.language === 'pl' ? 'cs' : 'pl'}>{counterpart || 'Brak jednoznacznego odpowiednika dla tego słowa.'}</blockquote>
      {selection.candidateOptions.length > 1 ? (
        <div className="reader-popover-hierarchy">
          <button
            type="button"
            aria-label="Mniejszy zakres"
            disabled={!canShrink}
            onClick={(event) => {
              event.stopPropagation()
              const next = selection.candidateOptions[activeIndex - 1]
              if (next) onSelectCandidate(next)
            }}
          >
            <Minus className="h-3.5 w-3.5" />
          </button>
          <span className="tabular-nums">
            {activeIndex + 1}/{selection.candidateOptions.length}
          </span>
          <button
            type="button"
            aria-label="Większy zakres"
            disabled={!canExpand}
            onClick={(event) => {
              event.stopPropagation()
              const next = selection.candidateOptions[activeIndex + 1]
              if (next) onSelectCandidate(next)
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}
    </aside>
  )
}

function DebugPanel({
  selection,
  overridesCount,
  onSaveOverride,
  onExportOverrides,
}: {
  selection: TokenSelection | null
  overridesCount: number
  onSaveOverride: () => void
  onExportOverrides: () => void
}) {
  return (
    <aside className="debug-panel">
      <div className="flex items-center justify-between gap-3">
        <h2>Token debug</h2>
        <span>{overridesCount} override</span>
      </div>
      {selection ? (
        <div className="mt-4 grid gap-3 text-sm">
          <DebugRow label="token_id" value={selection.token.id} />
          <DebugRow label="tekst" value={selection.token.text} />
          <DebugRow label="język" value={selection.token.language} />
          <DebugRow label="paragraph_id" value={selection.paragraph.id} />
          <DebugRow label="candidate_ids" value={selection.candidateIds.join('\n')} />
          <DebugRow label="aktywny kandydat" value={selection.activeCandidate?.id ?? 'brak'} />
          <Button variant="default" onClick={onSaveOverride}>Zapisz szkic poprawki</Button>
          <Button variant="secondary" onClick={onExportOverrides}>
            <Download className="h-4 w-4" />
            Pobierz moje poprawki JSON
          </Button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          <p>Kliknij token, żeby zobaczyć stabilne ID i najmniejszego kandydata alignmentowego.</p>
          <Button variant="secondary" onClick={onExportOverrides}>
            <Download className="h-4 w-4" />
            Pobierz moje poprawki JSON
          </Button>
        </div>
      )}
    </aside>
  )
}

function VolumeTile({ volume }: { volume: Volume }) {
  const locked = volume.status !== 'available'
  return (
    <div className="volume-tile">
      <div className="flex items-center justify-between gap-2">
        <p>{volume.label}</p>
        {locked ? <Lock className="h-4 w-4 text-muted-foreground" /> : <span>darmowy</span>}
      </div>
      <small>{volume.status === 'available' ? 'aktywny' : volume.status === 'locked' ? 'zablokowany' : 'wkrótce'}</small>
    </div>
  )
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

export default App

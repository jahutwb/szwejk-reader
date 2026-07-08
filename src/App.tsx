import { useCallback, useEffect, useMemo, useState, type CSSProperties, type FormEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { flushSync } from 'react-dom'
import { createRoot } from 'react-dom/client'
import { Bug, Check, ChevronLeft, ChevronRight, Download, Flag, Lock, Minus, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadMiniFixture } from '@/data/fixture'
import { buildReaderPages, collectPageFootnotesForBlocks, getReaderSegment, sliceParagraph, type ReaderPage, type ReaderPageBlock } from '@/domain/pagination'
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

type TokenClickHandler = (chapterId: string, paragraph: Paragraph, segmentId: string, token: Token, anchor?: DOMRect) => void

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
const WORK_TITLE = 'Przygody dobrego wojaka Szwejka podczas wojny światowej'
const PROGRESS_KEY = 'szwejk-reader.progress'
const OVERRIDES_KEY = 'szwejk-reader.overrides'
const MEASURE_MAX_PAGES = 1200
const MEASURE_YIELD_EVERY = 10
const MEASURE_RESIZE_DEBOUNCE_MS = 180
const MIN_TRAILING_PARAGRAPH_TOKENS = 4
const MIN_TRAILING_PARAGRAPH_CHARS = 24
const FEEDBACK_OPERATION_TYPE = 'token-feedback-flag'
const FEEDBACK_NOTE_MAX_LENGTH = 500
const FEEDBACK_SCHEMA_VERSION = 'reader-feedback-v1'
const SITE_DATA_OVERRIDES_ENDPOINT = './.herenow/data/override_submissions'
const EMPTY_CHAPTERS: Chapter[] = []
const EMPTY_FEEDBACK_TOKEN_KEYS = new Set<string>()
const VOLUME_COVER_SRC: Record<string, string> = {
  'volume-1': '/images/covers/tom_I.png',
  'volume-2': '/images/covers/tom_II.png',
  'volume-3': '/images/covers/tom_III.png',
  'volume-4': '/images/covers/tom_IV.png',
}

const defaultVolumes: Volume[] = [
  { id: 'volume-1', label: 'Tom I', status: 'available', chapters: [] },
  { id: 'volume-2', label: 'Tom II', status: 'locked', chapters: [] },
  { id: 'volume-3', label: 'Tom III', status: 'locked', chapters: [] },
  { id: 'volume-4', label: 'Tom IV', status: 'locked', chapters: [] },
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

function makeFeedbackTokenKey(chapterId: string, paragraphId: string, tokenId: string): string {
  return `${chapterId}\u0000${paragraphId}\u0000${tokenId}`
}

function getFeedbackTokenKeys(overrides: ReaderOverride[]): Set<string> {
  const keys = new Set<string>()
  for (const override of overrides) {
    for (const operation of override.operations) {
      if (operation.type !== FEEDBACK_OPERATION_TYPE || !operation.tokenId || !operation.paragraphId) continue
      keys.add(makeFeedbackTokenKey(override.chapterId, operation.paragraphId, operation.tokenId))
    }
  }
  return keys
}

function trimFeedbackNote(note: string): string {
  return note.trim().slice(0, FEEDBACK_NOTE_MAX_LENGTH)
}

function createFeedbackOverrideId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `feedback-${random}`
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

function getLibraryVolumes(volumes: Volume[]): Volume[] {
  return volumes.map((volume) => ({
    ...volume,
    status: volume.id === FIXTURE_VOLUME_ID ? 'available' : 'locked',
  }))
}

function getVolumeCoverSrc(volumeId: string): string {
  return VOLUME_COVER_SRC[volumeId] ?? VOLUME_COVER_SRC[FIXTURE_VOLUME_ID]
}

function getVolumeProgressPercent(fixture: ReaderFixture | null, progress: ReaderProgress | null): number {
  const volume = getAvailableVolume(fixture)
  if (!volume || !progress || progress.volumeId !== volume.id) return 0

  let totalTokenCount = 0
  let progressTokenIndex: number | null = null

  for (const chapter of volume.chapters) {
    for (const paragraph of chapter.paragraphs) {
      const segment = getReaderSegment(paragraph)
      const tokens = segment?.tokens ?? []
      const paragraphStartIndex = totalTokenCount

      if (progressTokenIndex === null && progress.chapterId === chapter.id && progress.paragraphId === paragraph.id) {
        const tokenIndex = progress.tokenId ? tokens.findIndex((token) => token.id === progress.tokenId) : -1
        progressTokenIndex = tokenIndex >= 0 ? paragraphStartIndex + tokenIndex : paragraphStartIndex
      }

      totalTokenCount += tokens.length
    }
  }

  if (totalTokenCount <= 0 || progressTokenIndex === null) return 0
  return Math.min(100, Math.max(0, Math.round((progressTokenIndex / totalTokenCount) * 100)))
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
  const libraryVolumes = useMemo(() => getLibraryVolumes(volumes), [volumes])
  const availableChapters = useMemo(() => getAvailableChapters(fixture), [fixture])
  const firstChapter = availableChapters[0]
  const chapterById = useMemo(() => new Map(availableChapters.map((chapter) => [chapter.id, chapter])), [availableChapters])
  const fallbackPages = useMemo(() => buildReaderPages(availableChapters), [availableChapters])
  const measuredPages = useMeasuredReaderPages(view === 'reader' ? availableChapters : EMPTY_CHAPTERS, chapterById, work?.id ?? 'work-szwejk')
  const pages = measuredPages.length > 0 ? measuredPages : fallbackPages
  const feedbackTokenKeys = useMemo(() => getFeedbackTokenKeys(overrides), [overrides])
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
  const volumeProgressPercent = useMemo(() => getVolumeProgressPercent(fixture, currentLocation), [currentLocation, fixture])

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
    await submitOverrides([override])
  }

  async function saveTokenFeedback(note: string) {
    if (!selection) return
    const trimmedNote = trimFeedbackNote(note)
    const nextOperation = {
      type: FEEDBACK_OPERATION_TYPE,
      tokenId: selection.token.id,
      candidateId: selection.activeCandidate?.id,
      paragraphId: selection.paragraph.id,
      value: {
        schemaVersion: FEEDBACK_SCHEMA_VERSION,
        segmentId: selection.segmentId,
        tokenText: selection.token.text,
        language: selection.token.language,
        candidateIds: selection.candidateIds.slice(0, 20),
        activeCandidateId: selection.activeCandidate?.id,
        note: trimmedNote || undefined,
        flagged: true,
      },
    }
    const existingFeedbackIndex = overrides.findIndex((override) =>
      override.chapterId === selection.chapterId &&
      override.operations.some(
        (operation) =>
          operation.type === FEEDBACK_OPERATION_TYPE &&
          operation.paragraphId === selection.paragraph.id &&
          operation.tokenId === selection.token.id,
      ),
    )
    const override: ReaderOverride =
      existingFeedbackIndex >= 0
        ? {
            ...overrides[existingFeedbackIndex],
            operations: overrides[existingFeedbackIndex].operations.map((operation) =>
              operation.type === FEEDBACK_OPERATION_TYPE &&
              operation.paragraphId === selection.paragraph.id &&
              operation.tokenId === selection.token.id
                ? nextOperation
                : operation,
            ),
          }
        : {
            id: createFeedbackOverrideId(),
            workId: work?.id ?? 'work-szwejk',
            volumeId: FIXTURE_VOLUME_ID,
            chapterId: selection.chapterId,
            baseArtifactId: fixture?.metadata.sourceArtifactId,
            createdAt: new Date().toISOString(),
            operations: [nextOperation],
          }
    const next =
      existingFeedbackIndex >= 0
        ? overrides.map((item, index) => (index === existingFeedbackIndex ? override : item))
        : [...overrides, override]

    if (existingFeedbackIndex >= 0) {
      override.workId = work?.id ?? override.workId
      override.volumeId = FIXTURE_VOLUME_ID
      override.chapterId = selection.chapterId
      override.baseArtifactId = fixture?.metadata.sourceArtifactId ?? override.baseArtifactId
    }
    setOverrides(next)
    writeOverrides(next)
    logCorrectionEvent({
      workId: override.workId,
      volumeId: override.volumeId,
      chapterId: override.chapterId,
      eventType: trimmedNote ? 'feedback_note_saved' : 'feedback_flag_saved',
      candidateId: selection.activeCandidate?.id,
      tokenId: selection.token.id,
    })
    await submitOverrides([override], { endpoint: SITE_DATA_OVERRIDES_ENDPOINT })
  }

  const exportOverrides = () => downloadJson('szwejk-reader-overrides.json', overrides)

  if (view === 'reader') {
    const canGoBack = resolvedPageIndex > 0
    const canGoForward = resolvedPageIndex < pages.length - 1
    const currentChapterTitle = currentPage?.chapterTitle ?? firstChapter?.title ?? 'Rozdział 1'
    const selectionFeedbackSaved = selection ? feedbackTokenKeys.has(makeFeedbackTokenKey(selection.chapterId, selection.paragraph.id, selection.token.id)) : false

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
                <span>{WORK_TITLE}</span>
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

            <ReaderPageBody
              page={currentPage}
              chapterById={chapterById}
              workId={work?.id ?? 'work-szwejk'}
              selection={selection}
              feedbackTokenKeys={feedbackTokenKeys}
              onTokenClick={handleTokenClick}
            />

            <ReaderPopover
              selection={selection}
              feedbackSaved={selectionFeedbackSaved}
              onSelectCandidate={selectCandidate}
              onSaveFeedback={saveTokenFeedback}
            />

            <div className="reader-page-foot" onClick={(event) => event.stopPropagation()}>
              <Button variant="ghost" size="sm" onClick={() => goToPage(resolvedPageIndex - 1)} disabled={!canGoBack} aria-label="Poprzednia strona">
                <ChevronLeft className="h-4 w-4" />
                Poprzednia
              </Button>
              <span className="reader-page-number tabular-nums" data-testid="reader-page-number">
                {currentPage?.displayPageNumber ?? resolvedPageIndex + 1}
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
      <div className="library-shell">
        <header className="library-hero">
          <p className="library-kicker">Hybrydowe wydanie PL {'->'} CS</p>
          <h1>{WORK_TITLE}</h1>
          <p className="library-lede">
            Czytaj polski tekst, który stopniowo przechodzi w czeski. Klikaj trudniejsze słowa, żeby zobaczyć równoległy fragment.
          </p>
          <div className="library-actions">
            <Button onClick={openReader} disabled={!fixture || !firstChapter}>
              Czytaj tom I
            </Button>
            <Button asChild variant="outline">
              <a href="#library-about">O projekcie</a>
            </Button>
          </div>
        </header>

        {loadError ? <p className="reader-error">{loadError}</p> : null}

        <section className="library-shelf" aria-labelledby="library-shelf-title">
          <div className="library-shelf-head">
            <h2 id="library-shelf-title">Tomy</h2>
            <p>Wybierz tom z półki.</p>
          </div>
          <div className="volume-grid">
            {libraryVolumes.map((volume) => (
              <VolumeTile
                key={volume.id}
                volume={volume}
                coverSrc={getVolumeCoverSrc(volume.id)}
                progressPercent={volume.id === FIXTURE_VOLUME_ID ? volumeProgressPercent : 0}
                onOpen={openReader}
              />
            ))}
          </div>
        </section>

        <section className="library-about" id="library-about" aria-labelledby="library-about-title">
          <p className="library-about-kicker">O projekcie</p>
          <h2 id="library-about-title">Powieść w dwóch językach</h2>
          <p>
            Publiczny czytnik pokazuje polski tekst z równoległymi czeskimi podstawieniami. Tom I można czytać od razu, a pozostałe
            tomy są jeszcze w przygotowaniu.
          </p>
        </section>
      </div>
    </main>
  )
}

function useMeasuredReaderPages(chapters: Chapter[], chapterById: Map<string, Chapter>, workId: string): ReaderPage[] {
  const [pages, setPages] = useState<ReaderPage[]>([])
  const [layoutVersion, setLayoutVersion] = useState(0)
  const shouldMeasure = chapters.length > 0 && !(typeof navigator !== 'undefined' && /jsdom/i.test(navigator.userAgent))

  useEffect(() => {
    let resizeTimer = 0
    const handleResize = () => {
      window.clearTimeout(resizeTimer)
      resizeTimer = window.setTimeout(() => setLayoutVersion((version) => version + 1), MEASURE_RESIZE_DEBOUNCE_MS)
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.clearTimeout(resizeTimer)
      window.removeEventListener('resize', handleResize)
    }
  }, [])

  useEffect(() => {
    if (!shouldMeasure) return

    let cancelled = false
    const measureStage = document.createElement('div')
    measureStage.className = 'reader-measure-stage'
    measureStage.setAttribute('aria-hidden', 'true')
    document.body.appendChild(measureStage)
    const root = createRoot(measureStage)
    let measureCount = 0

    const measurePage = async (page: ReaderPage): Promise<boolean> => {
      if (cancelled) return false
      measureCount += 1
      if (measureCount % MEASURE_YIELD_EVERY === 0) {
        await yieldToBrowser()
        if (cancelled) return false
      }
      flushSync(() => {
        root.render(<MeasuredReaderPage page={page} chapterById={chapterById} workId={workId} />)
      })
      const result = getMeasuredPageFit(measureStage)
      if (result === null) {
        throw new Error('Reader page measurement frame has no layout box')
      }
      return result
    }

    waitForReaderFonts()
      .then(() => buildMeasuredReaderPages(chapters, measurePage, () => cancelled))
      .then((nextPages) => {
        if (!cancelled && nextPages.length > 0) setPages(nextPages)
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          console.warn('Measured reader pagination failed', error)
          setPages([])
        }
      })

    return () => {
      cancelled = true
      root.unmount()
      measureStage.remove()
    }
  }, [chapterById, chapters, layoutVersion, shouldMeasure, workId])

  return shouldMeasure ? pages : []
}

async function waitForReaderFonts(): Promise<void> {
  if (!('fonts' in document)) return
  await document.fonts.ready
}

function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, 0))
}

function getMeasuredPageFit(container: HTMLElement): boolean | null {
  const frame = container.querySelector('.reader-page-frame')
  const content = container.querySelector('.reader-page-content')
  const notes = container.querySelector('.reader-page-notes')
  if (!(frame instanceof HTMLElement) || !(content instanceof HTMLElement) || frame.clientHeight <= 0 || content.clientHeight <= 0) return null
  const tolerance = 1
  const frameFits = frame.scrollHeight <= frame.clientHeight + tolerance
  const contentFits = content.scrollHeight <= content.clientHeight + tolerance
  const notesFit = !(notes instanceof HTMLElement) || notes.scrollHeight <= notes.clientHeight + tolerance
  return frameFits && contentFits && notesFit
}

async function buildMeasuredReaderPages(
  chapters: Chapter[],
  measurePage: (page: ReaderPage) => Promise<boolean>,
  isCancelled: () => boolean,
): Promise<ReaderPage[]> {
  const pages: ReaderPage[] = []
  const seenChapterIds = new Set<string>()
  let chapterIndex = 0
  let paragraphIndex = 0
  let charOffset = 0

  while (chapterIndex < chapters.length && pages.length < MEASURE_MAX_PAGES) {
    if (isCancelled()) return pages
    const chapter = chapters[chapterIndex]
    if (paragraphIndex >= chapter.paragraphs.length) {
      chapterIndex += 1
      paragraphIndex = 0
      charOffset = 0
      continue
    }

    const blocks: ReaderPageBlock[] = []
    const isChapterOpening = !seenChapterIds.has(chapter.id)

    while (paragraphIndex < chapter.paragraphs.length) {
      if (isCancelled()) return pages
      const paragraph = chapter.paragraphs[paragraphIndex]
      const segment = getReaderSegment(paragraph)
      if (!segment || charOffset >= segment.text.length) {
        paragraphIndex += 1
        charOffset = 0
        continue
      }

      const fullBlock = makeWebPageBlock(paragraph, blocks.length, charOffset, segment.text.length)
      const fullPage = makeWebReaderPage(chapter, pages.length + 1, isChapterOpening, [...blocks, fullBlock])
      const fullFits = await measurePage(fullPage)

      if (fullFits) {
        blocks.push(fullBlock)
        paragraphIndex += 1
        charOffset = 0
        continue
      }

      if (blocks.length > 0) {
        const splitEnd = await findMeasuredSliceEnd(chapter, paragraph, segment, charOffset, pages.length + 1, isChapterOpening, blocks, measurePage)
        if (splitEnd === null) break
        if (!isUsefulTrailingParagraphSlice(segment, charOffset, splitEnd)) break
        const splitBlock = makeWebPageBlock(paragraph, blocks.length, charOffset, splitEnd)
        blocks.push(splitBlock)
        charOffset = skipSliceWhitespace(segment.text, splitEnd)
        if (charOffset >= segment.text.length) {
          paragraphIndex += 1
          charOffset = 0
        }
        break
      }

      const splitEnd = await findMeasuredSliceEnd(chapter, paragraph, segment, charOffset, pages.length + 1, isChapterOpening, [], measurePage)
      if (splitEnd === null) {
        const firstBreakpoint = getTokenBreakpoints(segment, charOffset)[0]
        if (!firstBreakpoint) {
          paragraphIndex += 1
          charOffset = 0
          continue
        }
        const splitBlock = makeWebPageBlock(paragraph, 0, charOffset, firstBreakpoint)
        blocks.push(splitBlock)
        charOffset = skipSliceWhitespace(segment.text, firstBreakpoint)
        if (charOffset >= segment.text.length) {
          paragraphIndex += 1
          charOffset = 0
        }
        break
      }
      const splitBlock = makeWebPageBlock(paragraph, 0, charOffset, splitEnd)
      blocks.push(splitBlock)
      charOffset = skipSliceWhitespace(segment.text, splitEnd)
      if (charOffset >= segment.text.length) {
        paragraphIndex += 1
        charOffset = 0
      }
      break
    }

    if (blocks.length === 0) {
      chapterIndex += 1
      paragraphIndex = 0
      charOffset = 0
      continue
    }

    pages.push(makeWebReaderPage(chapter, pages.length + 1, isChapterOpening, blocks))
    seenChapterIds.add(chapter.id)
  }

  return pages
}

async function findMeasuredSliceEnd(
  chapter: Chapter,
  paragraph: Paragraph,
  segment: RenderSegment,
  start: number,
  pageNumber: number,
  isChapterOpening: boolean,
  prefixBlocks: ReaderPageBlock[],
  measurePage: (page: ReaderPage) => Promise<boolean>,
): Promise<number | null> {
  const breakpoints = getTokenBreakpoints(segment, start)
  if (breakpoints.length === 0) return null
  let low = 0
  let high = breakpoints.length - 1
  let bestEnd: number | null = null

  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidateEnd = breakpoints[middle]
    const candidatePage = makeWebReaderPage(chapter, pageNumber, isChapterOpening, [
      ...prefixBlocks,
      makeWebPageBlock(paragraph, prefixBlocks.length, start, candidateEnd),
    ])
    const fits = await measurePage(candidatePage)
    if (fits) {
      bestEnd = candidateEnd
      low = middle + 1
    } else {
      high = middle - 1
    }
  }

  return bestEnd
}

function getTokenBreakpoints(segment: RenderSegment, start: number): number[] {
  const breakpoints = segment.tokens
    .map((token) => token.end)
    .filter((offset) => offset > start && offset <= segment.text.length)
  if (breakpoints.at(-1) !== segment.text.length) breakpoints.push(segment.text.length)
  return Array.from(new Set(breakpoints)).sort((left, right) => left - right)
}

function isUsefulTrailingParagraphSlice(segment: RenderSegment, start: number, end: number): boolean {
  const tokenCount = segment.tokens.filter((token) => token.start >= start && token.end <= end && /\p{L}/u.test(token.text)).length
  const textLength = segment.text.slice(start, end).replace(/\s+/g, ' ').trim().length
  return tokenCount >= MIN_TRAILING_PARAGRAPH_TOKENS || textLength >= MIN_TRAILING_PARAGRAPH_CHARS
}

function skipSliceWhitespace(text: string, offset: number): number {
  let nextOffset = offset
  while (nextOffset < text.length && /\s/.test(text[nextOffset])) nextOffset += 1
  return nextOffset
}

function makeWebPageBlock(paragraph: Paragraph, sliceIndex: number, start: number, end: number): ReaderPageBlock {
  return {
    id: `${paragraph.id}:web-page-slice:${sliceIndex}:${start}:${end}`,
    paragraph: sliceParagraph(paragraph, start, end),
    continuation: start > 0,
  }
}

function makeWebReaderPage(chapter: Chapter, pageNumber: number, isChapterOpening: boolean, blocks: ReaderPageBlock[]): ReaderPage {
  return {
    id: `web-page-${pageNumber}`,
    chapterId: chapter.id,
    chapterTitle: chapter.title,
    isChapterOpening,
    displayPageNumber: pageNumber,
    blocks,
    footnotes: collectPageFootnotesForBlocks(chapter, blocks),
  }
}

function MeasuredReaderPage({ page, chapterById, workId }: { page: ReaderPage; chapterById: Map<string, Chapter>; workId: string }) {
  return (
    <article className="reader-page-frame reader-page-frame-measure" data-testid="reader-measure-page">
      <div className="reader-page-head" />
      <ReaderPageBody
        page={page}
        chapterById={chapterById}
        workId={workId}
        selection={null}
        feedbackTokenKeys={EMPTY_FEEDBACK_TOKEN_KEYS}
        onTokenClick={() => undefined}
      />
      <div className="reader-page-foot">
        <span className="reader-page-number tabular-nums">{page.displayPageNumber}</span>
      </div>
    </article>
  )
}

function ReaderPageBody({
  page,
  chapterById,
  workId,
  selection,
  feedbackTokenKeys,
  onTokenClick,
}: {
  page?: ReaderPage
  chapterById: Map<string, Chapter>
  workId: string
  selection: TokenSelection | null
  feedbackTokenKeys: Set<string>
  onTokenClick: TokenClickHandler
}) {
  return (
    <>
      <div className="reader-page-content">
        {page?.isChapterOpening ? <ChapterTitle chapter={chapterById.get(page.chapterId)} /> : null}
        {page
          ? page.blocks.map((block) => (
              <ReaderParagraph
                key={block.id}
                paragraph={block.paragraph}
                workId={workId}
                chapterId={page.chapterId}
                continuation={block.continuation}
                footnoteNumberById={new Map(page.footnotes.map((footnote, index) => [footnote.id, index + 1]))}
                selection={selection}
                feedbackTokenKeys={feedbackTokenKeys}
                onTokenClick={onTokenClick}
              />
            ))
          : null}
      </div>
      {page?.footnotes.length ? <PageFootnotes footnotes={page.footnotes} /> : null}
    </>
  )
}

function ChapterTitle({ chapter }: { chapter?: Chapter }) {
  if (!chapter) return null
  const titlePl = chapter.titlePl || chapter.title
  const titleCs = chapter.titleCs || titlePl
  const chapterNumber = getChapterNumber(chapter.id)
  const plStyle = chapter.titleSizesPt?.pl ? ({ fontSize: chapter.titleSizesPt.pl } satisfies CSSProperties) : undefined
  const csStyle = chapter.titleSizesPt?.cs ? ({ fontSize: chapter.titleSizesPt.cs } satisfies CSSProperties) : undefined

  return (
    <h2 className="chapter-title" aria-label={`${titlePl} ${titleCs}`}>
      {chapterNumber ? (
        <>
          <span className="chapter-title-label">ROZDZIAŁ</span>
          <span className="chapter-title-number">{chapterNumber}</span>
        </>
      ) : null}
      <span className="chapter-title-pl" style={plStyle}>
        {titlePl}
      </span>
      <span className="chapter-title-cs" lang="cs" style={csStyle}>
        {titleCs}
      </span>
    </h2>
  )
}

function getChapterNumber(chapterId: string): string | null {
  const match = /^chapter-(\d+)$/.exec(chapterId)
  if (!match) return null
  const volumeChapterNumber = Number(match[1])
  if (!Number.isFinite(volumeChapterNumber) || volumeChapterNumber <= 1) return null
  return String(volumeChapterNumber - 1)
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
  feedbackTokenKeys,
  onTokenClick,
}: {
  paragraph: Paragraph
  workId: string
  chapterId: string
  continuation: boolean
  footnoteNumberById: Map<string, number>
  selection: TokenSelection | null
  feedbackTokenKeys: Set<string>
  onTokenClick: TokenClickHandler
}) {
  const segment = getReaderSegment(paragraph)
  if (!segment) return null
  const parts = splitTokenTextParts(segment)

  return (
    <p
      className={cn('reader-paragraph', continuation && 'reader-paragraph-continuation')}
      lang={segment.language === 'hybrid' ? 'pl' : segment.language}
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
        const flagged = feedbackTokenKeys.has(makeFeedbackTokenKey(chapterId, paragraph.id, token.id))
        return (
          <span
            key={part.key}
            role="button"
            tabIndex={0}
            data-testid="reader-token"
            className={cn(
              'reader-token',
              token.language === 'cs' && 'reader-token-target',
              flagged && 'reader-token-feedback',
              activeRange && 'reader-token-active',
              clicked && 'reader-token-clicked',
            )}
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
            data-feedback={flagged ? 'flagged' : undefined}
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
  feedbackSaved,
  onSelectCandidate,
  onSaveFeedback,
}: {
  selection: TokenSelection | null
  feedbackSaved: boolean
  onSelectCandidate: (candidate: Candidate) => void
  onSaveFeedback: (note: string) => Promise<void>
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
  const feedbackFormKey = `${selection.chapterId}:${selection.paragraph.id}:${selection.token.id}`

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
      <ReaderFeedbackForm key={feedbackFormKey} feedbackSaved={feedbackSaved} onSaveFeedback={onSaveFeedback} />
    </aside>
  )
}

function ReaderFeedbackForm({
  feedbackSaved,
  onSaveFeedback,
}: {
  feedbackSaved: boolean
  onSaveFeedback: (note: string) => Promise<void>
}) {
  const [expanded, setExpanded] = useState(false)
  const [feedbackNote, setFeedbackNote] = useState('')
  const [feedbackState, setFeedbackState] = useState<'idle' | 'saving' | 'saved' | 'error'>(feedbackSaved ? 'saved' : 'idle')
  const trimmedNote = trimFeedbackNote(feedbackNote)
  const isSaved = feedbackSaved || feedbackState === 'saved'
  const canSubmitFeedback = feedbackState !== 'saving' && (!isSaved || trimmedNote.length > 0)
  const feedbackLabel = trimmedNote ? 'Zapisz uwagę' : isSaved ? 'Zapisane' : 'Oznacz'

  async function handleFlagButtonClick(event: ReactMouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    setExpanded(true)
    if (isSaved || feedbackState === 'saving') return
    setFeedbackState('saving')
    try {
      await onSaveFeedback('')
      setFeedbackState('saved')
    } catch (error) {
      console.warn('reader feedback save failed', error)
      setFeedbackState('error')
    }
  }

  async function handleFeedbackSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    event.stopPropagation()
    if (!canSubmitFeedback) return
    setFeedbackState('saving')
    try {
      await onSaveFeedback(feedbackNote)
      setFeedbackNote('')
      setFeedbackState('saved')
    } catch (error) {
      console.warn('reader feedback save failed', error)
      setFeedbackState('error')
    }
  }

  return (
    <form className={cn('reader-feedback-form', expanded && 'reader-feedback-form-expanded')} onSubmit={handleFeedbackSubmit}>
      <div className="reader-feedback-toolbar">
        <button
          type="button"
          className={cn('reader-feedback-flag-button', isSaved && 'reader-feedback-flag-button-saved')}
          aria-label={isSaved ? 'Dodaj uwagę do oznaczenia' : 'Oznacz do sprawdzenia'}
          title={isSaved ? 'Dodaj uwagę do oznaczenia' : 'Oznacz do sprawdzenia'}
          disabled={feedbackState === 'saving'}
          onClick={handleFlagButtonClick}
        >
          <Flag className="h-3.5 w-3.5" />
          {isSaved ? <Check className="reader-feedback-check h-3 w-3" /> : null}
        </button>
      </div>
      {expanded ? (
        <>
          <label className="reader-feedback-label" htmlFor="reader-feedback-note">
            Uwaga
            {isSaved ? (
              <span>
                <Check className="h-3.5 w-3.5" />
                zapisane
              </span>
            ) : null}
          </label>
          <textarea
            id="reader-feedback-note"
            aria-label="Uwaga do oznaczenia"
            maxLength={FEEDBACK_NOTE_MAX_LENGTH}
            placeholder="Opcjonalna uwaga"
            value={feedbackNote}
            onChange={(event) => setFeedbackNote(event.target.value)}
          />
          <div className="reader-feedback-actions">
            {feedbackState === 'error' ? <span className="reader-feedback-error">Nie udało się zapisać</span> : <span>{feedbackNote.length}/{FEEDBACK_NOTE_MAX_LENGTH}</span>}
            <button type="submit" disabled={!canSubmitFeedback}>
              <Flag className="h-3.5 w-3.5" />
              {feedbackState === 'saving' ? 'Zapisywanie' : feedbackLabel}
            </button>
          </div>
        </>
      ) : null}
    </form>
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

function VolumeTile({
  volume,
  coverSrc,
  progressPercent,
  onOpen,
}: {
  volume: Volume
  coverSrc: string
  progressPercent: number
  onOpen: () => void
}) {
  const locked = volume.status !== 'available'
  const statusLabel = locked ? 'w przygotowaniu' : `${progressPercent}% przeczytane`
  const coverLabel = locked ? 'w przygotowaniu' : 'czytaj za darmo'
  const actionLabel = locked ? 'w przygotowaniu' : 'Czytaj'
  const ariaLabel = locked ? `${volume.label}, w przygotowaniu` : `${volume.label}, czytaj za darmo, ${progressPercent}% przeczytane`

  return (
    <button
      type="button"
      className={cn('volume-tile', locked ? 'volume-tile-locked' : 'volume-tile-available')}
      disabled={locked}
      aria-label={ariaLabel}
      onClick={() => {
        if (!locked) onOpen()
      }}
    >
      <span className="volume-cover-frame">
        <img className="volume-cover-image" src={coverSrc} alt="" loading={volume.id === FIXTURE_VOLUME_ID ? 'eager' : 'lazy'} />
        <span className={cn('volume-cover-chip', locked ? 'volume-cover-chip-muted' : 'volume-cover-chip-active')}>
          {locked ? <Lock className="h-3.5 w-3.5" /> : null}
          <span>{coverLabel}</span>
        </span>
        {!locked ? (
          <span className="volume-progress-badge" data-testid={`volume-progress-${volume.id}`}>
            <span className="tabular-nums">{progressPercent}%</span>
          </span>
        ) : null}
      </span>
      <span className="volume-card-copy">
        <span className="volume-card-title">{volume.label}</span>
        <span className="volume-card-status">{statusLabel}</span>
        <span className="volume-card-action">
          {actionLabel}
          {!locked ? <ChevronRight className="h-4 w-4" /> : null}
        </span>
      </span>
    </button>
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

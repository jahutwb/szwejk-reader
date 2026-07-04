import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookOpen, Bug, ChevronLeft, ChevronRight, Download, Lock, Minus, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { loadMiniFixture } from '@/data/fixture'
import { findSmallestCandidateForToken } from '@/domain/selection'
import type { Candidate, Chapter, Paragraph, ReaderFixture, ReaderOverride, Token, Volume } from '@/domain/types'
import { logCorrectionEvent, logWordClick, submitOverrides } from '@/telemetry/telemetry'
import { cn } from '@/lib/utils'

type View = 'library' | 'reader'

type TokenSelection = {
  token: Token
  paragraph: Paragraph
  segmentId: string
  candidateIds: string[]
  activeCandidate?: Candidate
}

type ReaderPage = {
  id: string
  paragraphs: Paragraph[]
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
const FONT_KEY = 'szwejk-reader.font-size'
const PROGRESS_KEY = 'szwejk-reader.progress'
const OVERRIDES_KEY = 'szwejk-reader.overrides'

const defaultVolumes: Volume[] = [
  { id: 'volume-1', label: 'Tom I', status: 'available', chapters: [] },
  { id: 'volume-2', label: 'Tom II', status: 'locked', chapters: [] },
  { id: 'volume-3', label: 'Tom III', status: 'soon', chapters: [] },
  { id: 'volume-4', label: 'Tom IV', status: 'soon', chapters: [] },
]

function readNumber(key: string, fallback: number): number {
  const raw = localStorage.getItem(key)
  if (!raw) return fallback
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : fallback
}

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

function getFirstAvailableChapter(fixture: ReaderFixture | null): Chapter | undefined {
  return fixture?.work.volumes.find((volume) => volume.id === FIXTURE_VOLUME_ID)?.chapters[0]
}

function getSourceSegment(paragraph: Paragraph) {
  return paragraph.segments.find((segment) => segment.language === 'pl') ?? paragraph.segments[0]
}

function estimateParagraphLength(paragraph: Paragraph): number {
  const sourceSegment = getSourceSegment(paragraph)
  return sourceSegment?.text.length ?? 0
}

function getApproxPageCapacity(fontSize: number): number {
  return Math.max(520, Math.round(1330 - fontSize * 32))
}

function buildReaderPages(chapter: Chapter | undefined, fontSize: number): ReaderPage[] {
  if (!chapter) return []
  const capacity = getApproxPageCapacity(fontSize)
  const pages: ReaderPage[] = []
  let current: Paragraph[] = []
  let currentLength = 0

  for (const paragraph of chapter.paragraphs) {
    const paragraphLength = estimateParagraphLength(paragraph)
    const nextLength = currentLength + paragraphLength

    if (current.length > 0 && nextLength > capacity) {
      pages.push({ id: `${chapter.id}-page-${pages.length + 1}`, paragraphs: current })
      current = []
      currentLength = 0
    }

    current.push(paragraph)
    currentLength += paragraphLength
  }

  if (current.length > 0) {
    pages.push({ id: `${chapter.id}-page-${pages.length + 1}`, paragraphs: current })
  }

  return pages
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
  const [fontSize, setFontSize] = useState(() => readNumber(FONT_KEY, 18))
  const [selection, setSelection] = useState<TokenSelection | null>(null)
  const [overrides, setOverrides] = useState<ReaderOverride[]>(() => readOverrides())
  const [currentLocation, setCurrentLocation] = useState<ReaderProgress | null>(() => readProgress())
  const [currentPageIndex, setCurrentPageIndex] = useState(0)

  const debugMode = useMemo(() => getDebugMode(), [])
  const work = fixture?.work
  const volumes = work?.volumes ?? defaultVolumes
  const activeChapter = useMemo(() => getFirstAvailableChapter(fixture), [fixture])
  const pages = useMemo(() => buildReaderPages(activeChapter, fontSize), [activeChapter, fontSize])
  const resolvedPageIndex = useMemo(() => {
    if (pages.length === 0) return 0
    const paragraphId = currentLocation?.paragraphId
    if (paragraphId) {
      const indexFromLocation = pages.findIndex((page) => page.paragraphs.some((paragraph) => paragraph.id === paragraphId))
      if (indexFromLocation >= 0) return indexFromLocation
    }
    return Math.min(currentPageIndex, pages.length - 1)
  }, [currentLocation?.paragraphId, currentPageIndex, pages])
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

  useEffect(() => {
    document.documentElement.style.setProperty('--reader-font-size', `${fontSize}px`)
    localStorage.setItem(FONT_KEY, String(fontSize))
  }, [fontSize])

  const writeProgress = useCallback(
    (progress: Omit<ReaderProgress, 'workId' | 'volumeId' | 'chapterId' | 'updatedAt'>) => {
      if (!activeChapter) return
      const nextProgress: ReaderProgress = {
        workId: work?.id ?? 'work-szwejk',
        volumeId: FIXTURE_VOLUME_ID,
        chapterId: activeChapter.id,
        ...progress,
        updatedAt: new Date().toISOString(),
      }
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(nextProgress))
      setCurrentLocation(nextProgress)
    },
    [activeChapter, work?.id],
  )

  const goToPage = useCallback(
    (nextIndex: number) => {
      if (!pages.length) return
      const boundedIndex = Math.min(Math.max(nextIndex, 0), pages.length - 1)
      const nextPage = pages[boundedIndex]
      const firstParagraph = nextPage.paragraphs[0]
      const firstSegment = firstParagraph ? getSourceSegment(firstParagraph) : undefined
      setCurrentPageIndex(boundedIndex)
      setSelection(null)
      if (firstParagraph) {
        writeProgress({
          paragraphId: firstParagraph.id,
          segmentId: firstSegment?.id,
          tokenId: firstSegment?.tokens[0]?.id,
        })
      }
    },
    [pages, writeProgress],
  )

  useEffect(() => {
    if (view !== 'reader') return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') goToPage(resolvedPageIndex - 1)
      if (event.key === 'ArrowRight') goToPage(resolvedPageIndex + 1)
      if (event.key === 'Escape') setSelection(null)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [goToPage, resolvedPageIndex, view])

  function openReader() {
    setView('reader')
  }

  function handleTokenClick(paragraph: Paragraph, segmentId: string, token: Token) {
    const chapter = activeChapter
    if (!chapter) return
    const activeCandidate = findSmallestCandidateForToken(chapter.candidates, token.id)
    const nextSelection = {
      token,
      paragraph,
      segmentId,
      candidateIds: token.candidateIds,
      activeCandidate,
    }
    setSelection(nextSelection)
    writeProgress({
      paragraphId: paragraph.id,
      segmentId,
      tokenId: token.id,
    })
    logWordClick({
      workId: work?.id ?? 'work-szwejk',
      volumeId: FIXTURE_VOLUME_ID,
      chapterId: chapter.id,
      paragraphId: paragraph.id,
      tokenId: token.id,
      tokenText: token.text,
      language: token.language,
      candidateIds: token.candidateIds,
      activeCandidateId: activeCandidate?.id,
    })
  }

  async function saveDebugOverride() {
    if (!selection || !activeChapter) return
    const override: ReaderOverride = {
      id: `override-${Date.now()}`,
      workId: work?.id ?? 'work-szwejk',
      volumeId: FIXTURE_VOLUME_ID,
      chapterId: activeChapter.id,
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

    return (
      <main className="reader-view text-foreground" data-testid="reader-screen">
        <header className="reader-chrome">
          <div className="min-w-0">
            <button className="reader-back-link" onClick={() => setView('library')}>
              Biblioteczka
            </button>
            <h1>{work?.title ?? 'Dobry wojak Szwejk'}</h1>
          </div>
          <div className="reader-controls" aria-label="Ustawienia czytania">
            {debugMode ? (
              <span className="debug-pill">
                <Bug className="h-3.5 w-3.5" />
                debug
              </span>
            ) : null}
            <Button variant="outline" size="sm" onClick={() => setFontSize((value) => Math.max(15, value - 1))} aria-label="Zmniejsz font">
              <Minus className="h-4 w-4" />
            </Button>
            <label className="font-control">
              <span>Font</span>
              <input
                type="range"
                min="15"
                max="24"
                value={fontSize}
                onChange={(event) => setFontSize(Number(event.target.value))}
                aria-label="Wielkość fontu"
              />
              <span className="tabular-nums">{fontSize}px</span>
            </label>
            <Button variant="outline" size="sm" onClick={() => setFontSize((value) => Math.min(24, value + 1))} aria-label="Zwiększ font">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </header>

        {loadError ? <p className="reader-error">{loadError}</p> : null}

        <section className={cn('reader-stage', debugMode && 'reader-stage-debug')}>
          <article
            className="reader-page-frame"
            aria-label={`Strona ${resolvedPageIndex + 1} z ${pageCount}`}
            data-testid="reader-page-frame"
          >
            <div className="reader-page-head">
              <span>Tom I</span>
              <span>{activeChapter?.title?.replace(' - mini fixture', '') ?? 'Rozdział 1'}</span>
            </div>

            <div className="reader-page-content">
              {currentPage?.paragraphs.map((paragraph) => (
                <ReaderParagraph
                  key={paragraph.id}
                  paragraph={paragraph}
                  workId={work?.id ?? 'work-szwejk'}
                  chapterId={activeChapter?.id ?? 'chapter-001'}
                  selection={selection}
                  onTokenClick={handleTokenClick}
                />
              ))}
            </div>

            <ReaderPopover selection={selection} onClose={() => setSelection(null)} />

            <div className="reader-page-foot">
              <span>{resolvedPageIndex + 1}</span>
              <span>{pageCount}</span>
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

        <nav className="reader-navigation" aria-label="Nawigacja strony">
          <Button variant="outline" onClick={() => goToPage(resolvedPageIndex - 1)} disabled={!canGoBack} aria-label="Poprzednia strona">
            <ChevronLeft className="h-4 w-4" />
            Poprzednia
          </Button>
          <span className="reader-page-counter">
            Strona {resolvedPageIndex + 1} / {pageCount}
          </span>
          <Button variant="outline" onClick={() => goToPage(resolvedPageIndex + 1)} disabled={!canGoForward} aria-label="Następna strona">
            Następna
            <ChevronRight className="h-4 w-4" />
          </Button>
        </nav>
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
            <p>Publiczny czytnik tomu I. Kliknij słowo w tekście, żeby zobaczyć równoległy odpowiednik w języku czeskim.</p>
            {loadError ? <p className="reader-error">{loadError}</p> : null}
            <Button onClick={openReader} disabled={!fixture || !activeChapter}>
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

function ReaderParagraph({
  paragraph,
  workId,
  chapterId,
  selection,
  onTokenClick,
}: {
  paragraph: Paragraph
  workId: string
  chapterId: string
  selection: TokenSelection | null
  onTokenClick: (paragraph: Paragraph, segmentId: string, token: Token) => void
}) {
  const segment = getSourceSegment(paragraph)
  if (!segment) return null

  return (
    <p
      className="reader-paragraph"
      lang={segment.language}
      data-work-id={workId}
      data-volume-id={FIXTURE_VOLUME_ID}
      data-chapter-id={chapterId}
      data-paragraph-id={paragraph.id}
      data-segment-id={segment.id}
      data-candidate-ids={segment.candidateIds.join(' ')}
    >
      {segment.tokens.map((token) => {
        const activeRange = selection?.activeCandidate?.sourceTokenIds.includes(token.id) || selection?.activeCandidate?.tokenIds.includes(token.id)
        const clicked = selection?.token.id === token.id
        return (
          <span key={token.id}>
            <span
              role="button"
              tabIndex={0}
              data-testid="reader-token"
              className={cn('reader-token', activeRange && 'reader-token-active', clicked && 'reader-token-clicked')}
              onClick={() => onTokenClick(paragraph, segment.id, token)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  onTokenClick(paragraph, segment.id, token)
                }
              }}
              data-work-id={workId}
              data-volume-id={FIXTURE_VOLUME_ID}
              data-chapter-id={chapterId}
              data-paragraph-id={paragraph.id}
              data-segment-id={segment.id}
              data-token-id={token.id}
              data-candidate-ids={token.candidateIds.join(' ')}
            >
              {token.text}
            </span>{' '}
          </span>
        )
      })}
    </p>
  )
}

function ReaderPopover({ selection, onClose }: { selection: TokenSelection | null; onClose: () => void }) {
  if (!selection) return null
  const candidate = selection.activeCandidate
  const counterpart = selection.token.language === 'pl' ? candidate?.targetText : candidate?.sourceText
  const label = selection.token.language === 'pl' ? 'Czeski odpowiednik' : 'Polski odpowiednik'

  return (
    <aside className="reader-popover" role="dialog" aria-label="Odpowiednik">
      <div>
        <p>{label}</p>
        <button type="button" aria-label="Zamknij odpowiednik" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </div>
      <blockquote lang={selection.token.language === 'pl' ? 'cs' : 'pl'}>{counterpart || 'Brak jednoznacznego odpowiednika dla tego słowa.'}</blockquote>
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

import { useEffect, useMemo, useState } from 'react'
import { BookOpen, Download, Lock, Minus, Plus, Sparkles } from 'lucide-react'
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

function getFirstAvailableChapter(fixture: ReaderFixture | null): Chapter | undefined {
  return fixture?.work.volumes.find((volume) => volume.id === FIXTURE_VOLUME_ID)?.chapters[0]
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

function App() {
  const [view, setView] = useState<View>('library')
  const [fixture, setFixture] = useState<ReaderFixture | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [fontSize, setFontSize] = useState(() => readNumber(FONT_KEY, 18))
  const [selection, setSelection] = useState<TokenSelection | null>(null)
  const [overrides, setOverrides] = useState<ReaderOverride[]>(() => readOverrides())

  const work = fixture?.work
  const volumes = work?.volumes ?? defaultVolumes
  const activeChapter = useMemo(() => getFirstAvailableChapter(fixture), [fixture])

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
    const progress = {
      workId: work?.id ?? 'work-szwejk',
      volumeId: FIXTURE_VOLUME_ID,
      chapterId: chapter.id,
      paragraphId: paragraph.id,
      segmentId,
      tokenId: token.id,
      updatedAt: new Date().toISOString(),
    }
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress))
    logWordClick({
      workId: progress.workId,
      volumeId: progress.volumeId,
      chapterId: progress.chapterId,
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
    return (
      <main className="min-h-screen px-4 py-4 text-foreground sm:px-6 lg:px-8" data-testid="reader-screen">
        <div className="mx-auto flex max-w-7xl flex-col gap-4">
          <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <button className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setView('library')}>
                Biblioteczka
              </button>
              <h1 className="mt-1 text-2xl font-semibold tracking-normal">{work?.title ?? 'Dobry wojak Szwejk'}</h1>
              <p className="text-sm text-muted-foreground">MVP-0, debugowy przepływ akapitów, fixture rozdziału 1</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setFontSize((value) => Math.max(15, value - 1))} aria-label="Zmniejsz font">
                <Minus className="h-4 w-4" />
              </Button>
              <label className="flex items-center gap-2 text-sm text-muted-foreground">
                <span>Font</span>
                <input
                  className="w-28 accent-primary"
                  type="range"
                  min="15"
                  max="24"
                  value={fontSize}
                  onChange={(event) => setFontSize(Number(event.target.value))}
                />
                <span className="w-10 text-right tabular-nums">{fontSize}px</span>
              </label>
              <Button variant="outline" size="sm" onClick={() => setFontSize((value) => Math.min(24, value + 1))} aria-label="Zwiększ font">
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="secondary" size="sm" onClick={exportOverrides}>
                <Download className="h-4 w-4" />
                Pobierz moje poprawki JSON
              </Button>
            </div>
          </header>

          {loadError ? <p className="rounded-md border border-border bg-muted p-4 text-sm">{loadError}</p> : null}

          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <article className="min-h-[70vh] rounded-lg border border-border bg-background/82 px-4 py-5 shadow-sm sm:px-7">
              <h2 className="mb-5 text-lg font-semibold">{activeChapter?.title ?? 'Ładowanie fixture’a'}</h2>
              <div className="mx-auto flex max-w-[var(--reader-page-width)] flex-col gap-7">
                {activeChapter?.paragraphs.map((paragraph) => (
                  <section
                    key={paragraph.id}
                    className="grid gap-3 border-b border-border/70 pb-6 last:border-0"
                    data-work-id={work?.id}
                    data-volume-id={FIXTURE_VOLUME_ID}
                    data-chapter-id={activeChapter.id}
                    data-paragraph-id={paragraph.id}
                  >
                    {paragraph.segments.map((segment) => (
                      <p
                        key={segment.id}
                        className={cn(
                          'm-0 text-pretty',
                          segment.language === 'pl' ? 'font-serif text-[length:var(--reader-font-size)] leading-[var(--reader-line-height)]' : 'text-sm leading-7 text-muted-foreground',
                        )}
                        lang={segment.language}
                        data-work-id={work?.id}
                        data-volume-id={FIXTURE_VOLUME_ID}
                        data-chapter-id={activeChapter.id}
                        data-paragraph-id={paragraph.id}
                        data-segment-id={segment.id}
                        data-candidate-ids={segment.candidateIds.join(' ')}
                      >
                        {segment.tokens.map((token) => {
                          const activeRange = selection?.activeCandidate?.tokenIds.includes(token.id)
                          const clicked = selection?.token.id === token.id
                          return (
                            <span key={token.id}>
                              <span
                                role="button"
                                tabIndex={0}
                                data-testid="reader-token"
                                className={cn('reader-token', activeRange && 'reader-token-active', clicked && 'reader-token-clicked')}
                                onClick={() => handleTokenClick(paragraph, segment.id, token)}
                                onKeyDown={(event) => {
                                  if (event.key === 'Enter' || event.key === ' ') {
                                    event.preventDefault()
                                    handleTokenClick(paragraph, segment.id, token)
                                  }
                                }}
                                data-work-id={work?.id}
                                data-volume-id={FIXTURE_VOLUME_ID}
                                data-chapter-id={activeChapter.id}
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
                    ))}
                  </section>
                ))}
              </div>
            </article>

            <aside className="rounded-lg border border-border bg-background/88 p-4 shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold">Token debug</h2>
                <span className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{overrides.length} override</span>
              </div>
              {selection ? (
                <div className="mt-4 grid gap-3 text-sm">
                  <DebugRow label="token_id" value={selection.token.id} />
                  <DebugRow label="tekst" value={selection.token.text} />
                  <DebugRow label="język" value={selection.token.language} />
                  <DebugRow label="paragraph_id" value={selection.paragraph.id} />
                  <DebugRow label="candidate_ids" value={selection.candidateIds.join('\n')} />
                  <DebugRow label="aktywny kandydat" value={selection.activeCandidate?.id ?? 'brak'} />
                  <Button variant="default" onClick={saveDebugOverride}>Zapisz szkic poprawki</Button>
                </div>
              ) : (
                <p className="mt-4 text-sm leading-6 text-muted-foreground">Kliknij dowolny token PL albo CS, żeby zobaczyć stabilne ID i najmniejszego kandydata alignmentowego.</p>
              )}
            </aside>
          </div>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen px-4 py-6 text-foreground sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="mb-6 flex flex-col gap-2 border-b border-border pb-5">
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Sparkles className="h-4 w-4" />
            MVP-0 czytnika hybrydowego PL {'->'} CS
          </div>
          <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">Biblioteczka</h1>
        </header>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="rounded-lg border border-border bg-background/88 p-5 shadow-sm">
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="max-w-2xl">
                <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-md bg-primary text-primary-foreground">
                  <BookOpen className="h-6 w-6" />
                </div>
                <h2 className="text-2xl font-semibold">Dobry wojak Szwejk</h2>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  Pierwszy techniczny podgląd czytnika na małym fixture z rozdziału 1. Dane pochodzą ze strukturalnego artefaktu alignmentowego, nie z PDF.
                </p>
              </div>
              <Button onClick={openReader} disabled={!fixture || !activeChapter}>
                <BookOpen className="h-4 w-4" />
                Czytaj Tom I
              </Button>
            </div>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {volumes.map((volume) => (
                <VolumeTile key={volume.id} volume={volume} />
              ))}
            </div>
            {loadError ? <p className="mt-4 rounded-md border border-border bg-muted p-3 text-sm">{loadError}</p> : null}
          </div>

          <aside className="rounded-lg border border-border bg-background/88 p-5 shadow-sm">
            <h2 className="text-base font-semibold">Stan MVP-0</h2>
            <ul className="mt-3 grid gap-2 text-sm leading-6 text-muted-foreground">
              <li>Fixture: chapter_001 checkpoint {'->'} reader-fixture</li>
              <li>Stabilne atrybuty DOM dla tokenów i segmentów</li>
              <li>Lokalna telemetryka w buforze localStorage</li>
              <li>Eksport override’ów jako JSON</li>
            </ul>
          </aside>
        </section>
      </div>
    </main>
  )
}

function VolumeTile({ volume }: { volume: Volume }) {
  const locked = volume.status !== 'available'
  return (
    <div className="rounded-md border border-border bg-muted/45 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">{volume.label}</p>
        {locked ? <Lock className="h-4 w-4 text-muted-foreground" /> : <span className="rounded-sm bg-secondary px-2 py-1 text-xs text-secondary-foreground">darmowy</span>}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{volume.status === 'available' ? 'aktywny' : volume.status === 'locked' ? 'zablokowany' : 'wkrótce'}</p>
    </div>
  )
}

function DebugRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 max-h-28 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-5 text-foreground break-all whitespace-pre-wrap">{value}</dd>
    </div>
  )
}

export default App

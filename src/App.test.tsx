/// <reference types="node" />

import { readFileSync } from 'node:fs'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import appSource from './App.tsx?raw'
import paginationSource from './domain/pagination.ts?raw'
import cssSource from './index.css?raw'
import type { ReaderFixture, ReaderPageMap, Token } from './domain/types'

const readerFixture = JSON.parse(readFileSync(`${process.cwd()}/public/data/fixtures/szwejk-mini/reader-fixture.json`, 'utf8')) as ReaderFixture
const latexPageMap = JSON.parse(readFileSync(`${process.cwd()}/public/data/fixtures/szwejk-mini/page-map-latex-v13-volume-1.json`, 'utf8')) as ReaderPageMap
const workTitle = 'Przygody dobrego wojaka Szwejka podczas wojny światowej'
const fixtureResponse = () => new Response(JSON.stringify(readerFixture), { status: 200, headers: { 'content-type': 'application/json' } })
const pageMapResponse = () => new Response(JSON.stringify(latexPageMap), { status: 200, headers: { 'content-type': 'application/json' } })

function getContactNavButton(): HTMLElement {
  return screen.getByRole('button', { name: /kontakt/i })
}

function getVolumeOneReaderButton(): HTMLElement {
  return screen.getByRole('button', { name: /tom i, szwejk na tyłach, czytaj za darmo, \d+% przeczytane/i })
}

async function findVisibleTargetToken(user: ReturnType<typeof userEvent.setup>, maxPages = 20): Promise<HTMLElement> {
  for (let page = 0; page < maxPages; page += 1) {
    const targetToken = (await screen.findAllByTestId('reader-token')).find((token) => token.getAttribute('lang') === 'cs')
    if (targetToken) return targetToken

    const nextButton = screen.getByRole('button', { name: /następna strona/i }) as HTMLButtonElement
    if (nextButton.disabled) break
    await user.click(nextButton)
  }

  throw new Error('No visible Czech token found in the checked pages')
}

async function findVisibleLemmaIntro(user: ReturnType<typeof userEvent.setup>, maxPages = 30): Promise<HTMLElement> {
  for (let page = 0; page < maxPages; page += 1) {
    const intro = document.querySelector('.lemma-intro')
    if (intro instanceof HTMLElement) return intro

    const nextButton = screen.getByRole('button', { name: /następna strona/i }) as HTMLButtonElement
    if (nextButton.disabled) break
    await user.click(nextButton)
  }

  throw new Error('No visible lemma intro found in the checked pages')
}

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    window.history.pushState({}, '', '/')
    vi.stubGlobal(
      'fetch',
      vi.fn((input: RequestInfo | URL) => {
        const url = String(input)
        if (url.includes('page-map-latex-v13-volume-1.json')) return Promise.resolve(pageMapResponse())
        return Promise.resolve(fixtureResponse())
      }),
    )
  })

  it('shows a public library and opens a book-like reader page', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByRole('heading', { name: /szwejk reader/i })).toBeInTheDocument()
    expect(screen.getByText(/czytaj po polsku\. ucz się czeskiego, zanim zauważysz\./i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tomy/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^więcej$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /kontakt/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dowiedz się więcej/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tom i, szwejk na tyłach, czytaj za darmo, 0% przeczytane/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tom ii, szwejk na froncie, w przygotowaniu/i })).toBeDisabled()

    await user.click(getVolumeOneReaderButton())

    expect(await screen.findByTestId('reader-screen')).toBeInTheDocument()
    expect(screen.getByText(/demo hybrydowego czytania/i)).toBeInTheDocument()
    expect(screen.getByTestId('reader-page-frame')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /następna strona/i })).toBeInTheDocument()
    expect(screen.getByText(/biblioteczka/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /spis treści/i })).toBeInTheDocument()
    expect(screen.getAllByTestId('reader-token').length).toBeGreaterThan(0)
  })

  it('shows stable reading progress on the active volume cover', async () => {
    const chapter = readerFixture.work.volumes[0].chapters[9]
    const paragraph = chapter.paragraphs[Math.floor(chapter.paragraphs.length / 2)]
    const segment = paragraph.segments[0]
    const token = segment.tokens[Math.floor(segment.tokens.length / 2)]
    localStorage.setItem(
      'szwejk-reader.progress',
      JSON.stringify({
        workId: readerFixture.work.id,
        volumeId: 'volume-1',
        chapterId: chapter.id,
        paragraphId: paragraph.id,
        segmentId: segment.id,
        tokenId: token.id,
        updatedAt: '2026-07-08T00:00:00.000Z',
      }),
    )

    render(<App />)

    await waitFor(
      () => {
        const progressText = screen.getByTestId('volume-progress-volume-1').textContent ?? ''
        const progress = Number(progressText.match(/\d+/)?.[0] ?? 0)
        expect(progress).toBeGreaterThan(0)
        expect(progress).toBeLessThan(100)
      },
      { timeout: 5000 },
    )
  })

  it('stores interest leads locally from the landing form', async () => {
    const user = userEvent.setup()
    render(<App />)

    await user.click(getContactNavButton())

    const emailInput = screen.getByRole('textbox', { name: /adres e-mail/i })
    await user.type(emailInput, 'reader@example.com')
    await user.selectOptions(screen.getByRole('combobox', { name: /interesuje mnie/i }), 'audiobook')
    await user.click(screen.getByRole('button', { name: /zapisz zainteresowanie/i }))

    expect(screen.getByText(/dzięki! to tymczasowe demo/i)).toBeInTheDocument()

    const stored = JSON.parse(localStorage.getItem('szwejk-reader.interest') ?? '[]') as Array<{ email: string; interest: string }>
    expect(stored.at(-1)).toMatchObject({ email: 'reader@example.com', interest: 'audiobook' })
  })

  it('uses a single-line breadcrumb with a clickable table of contents', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const pageFrame = await screen.findByTestId('reader-page-frame')
    expect(within(pageFrame).getByText('Biblioteczka')).toBeInTheDocument()
    expect(within(pageFrame).getByText(workTitle)).toBeInTheDocument()
    expect(within(pageFrame).getByText('Tom I')).toBeInTheDocument()

    await user.click(within(pageFrame).getByRole('button', { name: /spis treści/i }))

    expect(await screen.findByRole('dialog', { name: /spis treści/i })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /szwejk w garnizonie/i }))

    expect(screen.getByRole('button', { name: /spis treści: szwejk w garnizonie/i })).toBeInTheDocument()
  })

  it('keeps a sliced paragraph page reachable when progress points at a segment slice', async () => {
    localStorage.setItem(
      'szwejk-reader.progress',
      JSON.stringify({
        workId: 'work-szwejk',
        volumeId: 'volume-1',
        chapterId: 'chapter-010',
        paragraphId: 'book-pl-przygody-dobrego-wojaka-szwejka-podczas-wojny-swiatowej-ch-010-p-0022',
        segmentId: 'book-pl-przygody-dobrego-wojaka-szwejka-podczas-wojny-swiatowej-ch-010-p-0022:hybrid::slice:384:495',
        updatedAt: '2026-07-04T00:00:00.000Z',
      }),
    )
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    expect(await screen.findByRole('button', { name: /spis treści: szwejk w garnizonie/i })).toBeInTheDocument()
  })

  it('loads the whole first volume from v13 plan and full hierarchical alignment artifacts', () => {
    const volume = readerFixture.work.volumes[0]
    const chapterIds = volume.chapters.map((chapter) => chapter.id)
    const paragraphCount = volume.chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0)
    const candidateCount = volume.chapters.reduce((total, chapter) => total + chapter.candidates.length, 0)

    expect(readerFixture.metadata.fixtureKind).toBe('szwejk-volume-1-v13-reader-derived')
    expect(chapterIds).toEqual([
      'chapter-001',
      'chapter-002',
      'chapter-003',
      'chapter-004',
      'chapter-005',
      'chapter-006',
      'chapter-007',
      'chapter-008',
      'chapter-009',
      'chapter-010',
      'chapter-011',
      'chapter-012',
      'chapter-013',
      'chapter-014',
      'chapter-015',
      'chapter-016',
      'chapter-017',
    ])
    expect(paragraphCount).toBeGreaterThan(800)
    expect(candidateCount).toBeGreaterThan(12_000)
  })

  it('carries bilingual adaptive chapter title metadata from hybrydyzer artifacts', () => {
    const secondChapter = readerFixture.work.volumes[0].chapters[1]

    expect(secondChapter.title).toBe('Jak dobry wojak Szwejk wkroczył na widownię wojny światowej')
    expect(secondChapter.titlePl).toBe('Jak dobry wojak Szwejk wkroczył na widownię wojny światowej')
    expect(secondChapter.titleCs).toBe('Zasáhnutí dobrého vojáka Švejka do světové války')
    expect(secondChapter.targetExposure).toBeGreaterThan(0)
    expect(secondChapter.titleSizesPt?.pl).toMatch(/pt$/)
    expect(secondChapter.titleSizesPt?.cs).toMatch(/pt$/)
  })

  it('renders bilingual adaptive chapter titles on chapter opening pages', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const pageFrame = await screen.findByTestId('reader-page-frame')
    expect(within(pageFrame).getByRole('heading', { name: /wstęp úvod/i })).toBeInTheDocument()
    expect(pageFrame.querySelector('.chapter-title-pl')).toHaveTextContent('Wstęp')
    expect(pageFrame.querySelector('.chapter-title-cs')).toHaveTextContent('Úvod')

    await user.click(screen.getByRole('button', { name: /następna strona/i }))

    expect(within(pageFrame).queryByRole('heading', { name: /wstęp úvod/i })).not.toBeInTheDocument()
  })

  it('renders numbered chapter opening labels to match the LaTeX volume', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const pageFrame = await screen.findByTestId('reader-page-frame')
    await user.click(within(pageFrame).getByRole('button', { name: /spis treści/i }))
    await user.click(screen.getByRole('button', { name: /jak dobry wojak szwejk wkroczył/i }))

    expect(pageFrame.querySelector('.chapter-title-label')).toHaveTextContent('ROZDZIAŁ')
    expect(pageFrame.querySelector('.chapter-title-number')).toHaveTextContent('1')
  })

  it('uses larger long-form reader typography for screen reading', () => {
    expect(cssSource).toContain('--reader-font-size: clamp(15px, 3cqw, 17.5px);')
    expect(cssSource).toContain('--reader-line-height: 1.34;')
    expect(cssSource).toContain('hyphens: auto;')
    expect(appSource).toContain("lang={segment.language === 'hybrid' ? 'pl' : segment.language}")
    expect(cssSource).toContain('url("/fonts/tex-gyre/texgyrepagella-regular.otf")')
    expect(cssSource).toContain('--reader-source-font: "TeX Gyre Pagella", "TeXGyrePagella"')
    expect(cssSource).toContain('--reader-target-font: "TeX Gyre Heros", "TeXGyreHeros"')
  })

  it('keeps the mobile reader breadcrumb compact without duplicate separators', () => {
    expect(cssSource).toContain('.reader-breadcrumb span:nth-of-type(1),')
    expect(cssSource).toContain('.reader-breadcrumb span:nth-of-type(2) {')
  })

  it('prefers measured web pagination with estimated pagination as fallback', () => {
    expect(appSource).toContain('useMeasuredReaderPages')
    expect(appSource).toContain('const pages = measuredPages.length > 0 ? measuredPages : fallbackPages')
    expect(appSource).not.toContain('loadLatexPageMap')
    expect(appSource).not.toContain('buildReaderPagesFromPageMap(availableChapters')
    expect(paginationSource).toContain('export const PAGE_LINE_CAPACITY')
    expect(paginationSource).toContain('function estimateTextLineCost')
    expect(appSource).not.toContain('const PAGE_CHAR_CAPACITY')
  })

  it('fills measured pages with a fitting slice of the next paragraph before closing the page', () => {
    expect(appSource).not.toContain('if (blocks.length > 0) break')
    expect(appSource).toContain('findMeasuredSliceEnd(chapter, paragraph, segment, charOffset, pages.length + 1, isChapterOpening, blocks, measurePage)')
    expect(appSource).toContain('...prefixBlocks')
  })

  it('avoids orphaned one-word starts of the next paragraph at the bottom of a measured page', () => {
    expect(appSource).toContain('const MIN_TRAILING_PARAGRAPH_TOKENS =')
    expect(appSource).toContain('const MIN_TRAILING_PARAGRAPH_CHARS =')
    expect(appSource).toContain('isUsefulTrailingParagraphSlice(segment, charOffset, splitEnd)')
  })

  it('keeps measured pagination responsive by yielding and debouncing resize repagination', () => {
    expect(appSource).toContain('const MEASURE_YIELD_EVERY =')
    expect(appSource).toContain('await yieldToBrowser()')
    expect(appSource).toContain('const MEASURE_RESIZE_DEBOUNCE_MS =')
    expect(appSource).toContain('window.setTimeout(() => setLayoutVersion')
  })

  it('keeps the reference LaTeX page-map boundaries aligned with the rendered volume PDF', () => {
    const [introFirstPage, introSecondPage, chapterFirstPage, chapterSecondPage, chapterThirdPage] = latexPageMap.pages

    expect(introFirstPage.displayPageNumber).toBe(1)
    expect(introSecondPage.displayPageNumber).toBe(2)
    expect(chapterFirstPage.displayPageNumber).toBe(3)
    expect(introSecondPage.start.chapterId).toBe('chapter-001')
    expect(introSecondPage.end).toMatchObject({
      chapterId: 'chapter-001',
      paragraphId: 'book-pl-przygody-dobrego-wojaka-szwejka-podczas-wojny-swiatowej-ch-001-p-0005',
      charOffset: 5,
    })
    expect(chapterFirstPage.start).toMatchObject({
      chapterId: 'chapter-002',
      paragraphId: 'book-pl-przygody-dobrego-wojaka-szwejka-podczas-wojny-swiatowej-ch-002-p-0001',
      charOffset: 0,
    })
    expect(chapterThirdPage.start).toMatchObject({
      chapterId: 'chapter-002',
      paragraphId: 'book-pl-przygody-dobrego-wojaka-szwejka-podczas-wojny-swiatowej-ch-002-p-0009',
      charOffset: 279,
    })
    expect(chapterSecondPage.end).toMatchObject({
      chapterId: 'chapter-002',
      paragraphId: 'book-pl-przygody-dobrego-wojaka-szwejka-podczas-wojny-swiatowej-ch-002-p-0009',
      charOffset: 278,
    })
  })

  it('contains intro annotations, footnotes, and hierarchical candidate memberships from source artifacts', () => {
    const chapters = readerFixture.work.volumes[0].chapters
    const tokens: Token[] = readerFixture.work.volumes[0].chapters.flatMap((chapter) =>
      chapter.paragraphs.flatMap((paragraph) => paragraph.segments.flatMap((segment) => segment.tokens)),
    )
    const footnotes = chapters.flatMap((chapter) => chapter.footnotes)

    expect(tokens.some((token) => token.language === 'cs' && token.candidateIds.length > 1)).toBe(true)
    expect(tokens.some((token) => token.language === 'cs' && token.introIds?.length)).toBe(true)
    expect(tokens.some((token) => token.language === 'cs' && token.footnoteIds?.length)).toBe(true)
    expect(footnotes.length).toBeGreaterThan(100)
    expect(footnotes.some((footnote) => footnote.text.includes('—'))).toBe(true)
  })

  it('keeps debug and admin controls hidden in the public reader', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.click(getVolumeOneReaderButton())

    expect(await screen.findByTestId('reader-screen')).toBeInTheDocument()
    expect(screen.queryByText('Token debug')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pobierz moje poprawki json/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /zwiększ font/i })).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/wielkość fontu/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/strona\s+\d+\s*\/\s*\d+/i)).not.toBeInTheDocument()
    expect(container.querySelector('.debug-panel')).not.toBeInTheDocument()
  })

  it('renders tokenized prose without synthetic spaces before punctuation', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const pageText = (await screen.findByTestId('reader-page-frame')).textContent ?? ''

    expect(pageText).not.toMatch(/\s+[,.!?;:]/)
  })

  it('opens a compact reader popover with counterpart text and stores reading progress', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const token = (await screen.findAllByTestId('reader-token'))[0]
    await user.click(token)

    expect(await screen.findByRole('dialog', { name: /równoległy tekst/i })).toBeInTheDocument()
    expect(screen.queryByText(/czeski odpowiednik/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/polski odpowiednik/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /zamknij odpowiednik/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Token debug')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(localStorage.getItem('szwejk-reader.progress')).toContain('tokenId')
    })
  })

  it('lets the public reader flag a token with an optional note for later review', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const token = (await screen.findAllByTestId('reader-token'))[0]
    await user.click(token)

    const dialog = await screen.findByRole('dialog', { name: /równoległy tekst/i })
    expect(within(dialog).queryByLabelText(/uwaga do oznaczenia/i)).not.toBeInTheDocument()
    await user.click(within(dialog).getByRole('button', { name: /oznacz do sprawdzenia/i }))
    expect(await within(dialog).findByLabelText(/uwaga do oznaczenia/i)).toBeInTheDocument()
    await user.type(within(dialog).getByLabelText(/uwaga do oznaczenia/i), 'To podstawienie brzmi sztucznie.')
    await user.click(within(dialog).getByRole('button', { name: /zapisz uwagę/i }))

    await waitFor(() => {
      const overrides = JSON.parse(localStorage.getItem('szwejk-reader.overrides') ?? '[]')
      expect(overrides).toHaveLength(1)
      expect(overrides[0].operations[0]).toMatchObject({
        type: 'token-feedback-flag',
        tokenId: token.dataset.tokenId,
        paragraphId: token.dataset.paragraphId,
        value: {
          note: 'To podstawienie brzmi sztucznie.',
          flagged: true,
        },
      })
    })
    expect(token).toHaveAttribute('data-feedback', 'flagged')
    expect(within(dialog).getAllByText(/zapisane/i).length).toBeGreaterThan(0)
  })

  it('uses an amber highlight for the whole active popup phrase', () => {
    expect(cssSource).toContain('.reader-token-active')
    expect(cssSource).toContain('hsl(43 92% 58%) 28%')
    expect(cssSource).toContain('.reader-token-clicked')
    expect(cssSource).toContain('hsl(43 92% 58%) 38%')
  })

  it('closes the popover when the reader background is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const token = (await screen.findAllByTestId('reader-token'))[0]
    await user.click(token)
    expect(await screen.findByRole('dialog', { name: /równoległy tekst/i })).toBeInTheDocument()

    await user.click(screen.getByTestId('reader-page-frame'))

    expect(screen.queryByRole('dialog', { name: /równoległy tekst/i })).not.toBeInTheDocument()
  })

  it('uses the hybrydyzer target typography class for Czech substitutions', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    const targetToken = await findVisibleTargetToken(user)

    expect(targetToken).toHaveClass('reader-token-target')
  })

  it('bolds first target lemma introductions from intro annotations', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    expect(await findVisibleLemmaIntro(user)).toHaveClass('lemma-intro')
  })

  it('shows compact candidate hierarchy controls for substituted tokens', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    await user.click(await findVisibleTargetToken(user))

    expect(await screen.findByRole('dialog', { name: /równoległy tekst/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /większy zakres/i })).toBeInTheDocument()
    expect(screen.getByText(/1\/\d+/)).toBeInTheDocument()
  })

  it('shows debug tools only behind the debug query flag', async () => {
    window.history.pushState({}, '', '/?debug=1')
    const user = userEvent.setup()
    render(<App />)
    await user.click(getVolumeOneReaderButton())

    expect(await screen.findByText('Token debug')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pobierz moje poprawki json/i })).toBeInTheDocument()
  })
})

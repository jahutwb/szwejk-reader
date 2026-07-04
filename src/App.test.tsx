import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import appSource from './App.tsx?raw'
import cssSource from './index.css?raw'
import fixture from '../public/data/fixtures/szwejk-mini/reader-fixture.json'
import type { ReaderFixture, Token } from './domain/types'

const readerFixture = fixture as unknown as ReaderFixture
const response = new Response(JSON.stringify(readerFixture), { status: 200, headers: { 'content-type': 'application/json' } })

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
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response.clone()))
  })

  it('shows a public library and opens a book-like reader page', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('Dobry wojak Szwejk')).toBeInTheDocument()
    expect(screen.getByText('Tom I')).toBeInTheDocument()
    expect(screen.getByText('Tom II')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    expect(await screen.findByTestId('reader-screen')).toBeInTheDocument()
    expect(screen.getByTestId('reader-page-frame')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /następna strona/i })).toBeInTheDocument()
    expect(screen.getByText(/biblioteczka/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /spis treści/i })).toBeInTheDocument()
    expect(screen.getAllByTestId('reader-token').length).toBeGreaterThan(0)
  })

  it('uses a single-line breadcrumb with a clickable table of contents', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    const pageFrame = await screen.findByTestId('reader-page-frame')
    expect(within(pageFrame).getByText('Biblioteczka')).toBeInTheDocument()
    expect(within(pageFrame).getByText('Dobry wojak Szwejk')).toBeInTheDocument()
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
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    expect(await screen.findByTestId('reader-page-number')).toHaveTextContent('95')
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
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    const pageFrame = await screen.findByTestId('reader-page-frame')
    expect(within(pageFrame).getByRole('heading', { name: /wstęp úvod/i })).toBeInTheDocument()
    expect(pageFrame.querySelector('.chapter-title-pl')).toHaveTextContent('Wstęp')
    expect(pageFrame.querySelector('.chapter-title-cs')).toHaveTextContent('Úvod')

    await user.click(screen.getByRole('button', { name: /następna strona/i }))

    expect(within(pageFrame).queryByRole('heading', { name: /wstęp úvod/i })).not.toBeInTheDocument()
  })

  it('uses larger long-form reader typography for screen reading', () => {
    expect(cssSource).toContain('--reader-font-size: clamp(16px, 3.18cqw, 19px);')
    expect(cssSource).toContain('--reader-line-height: 1.34;')
  })

  it('paginates with an estimated line budget instead of raw character capacity', () => {
    expect(appSource).toContain('const PAGE_LINE_CAPACITY')
    expect(appSource).toContain('function estimateTextLineCost')
    expect(appSource).not.toContain('const PAGE_CHAR_CAPACITY')
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
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

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
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    const pageText = (await screen.findByTestId('reader-page-frame')).textContent ?? ''

    expect(pageText).not.toMatch(/\s+[,.!?;:]/)
  })

  it('opens a compact reader popover with counterpart text and stores reading progress', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

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

  it('closes the popover when the reader background is clicked', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    const token = (await screen.findAllByTestId('reader-token'))[0]
    await user.click(token)
    expect(await screen.findByRole('dialog', { name: /równoległy tekst/i })).toBeInTheDocument()

    await user.click(screen.getByTestId('reader-page-frame'))

    expect(screen.queryByRole('dialog', { name: /równoległy tekst/i })).not.toBeInTheDocument()
  })

  it('uses the hybrydyzer target typography class for Czech substitutions', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    const targetToken = await findVisibleTargetToken(user)

    expect(targetToken).toHaveClass('reader-token-target')
  })

  it('bolds first target lemma introductions from intro annotations', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    expect(await findVisibleLemmaIntro(user)).toHaveClass('lemma-intro')
  })

  it('shows compact candidate hierarchy controls for substituted tokens', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    await user.click(await findVisibleTargetToken(user))

    expect(await screen.findByRole('dialog', { name: /równoległy tekst/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /większy zakres/i })).toBeInTheDocument()
    expect(screen.getByText(/1\/\d+/)).toBeInTheDocument()
  })

  it('shows debug tools only behind the debug query flag', async () => {
    window.history.pushState({}, '', '/?debug=1')
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    expect(await screen.findByText('Token debug')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /pobierz moje poprawki json/i })).toBeInTheDocument()
  })
})

import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import fixture from '../public/data/fixtures/szwejk-mini/reader-fixture.json'

const response = new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } })

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
    expect(screen.getAllByTestId('reader-token').length).toBeGreaterThan(0)
  })

  it('loads the whole first volume from real alignment and hybridization artifacts', () => {
    const volume = fixture.work.volumes[0]
    const chapterIds = volume.chapters.map((chapter) => chapter.id)
    const paragraphCount = volume.chapters.reduce((total, chapter) => total + chapter.paragraphs.length, 0)
    const candidateCount = volume.chapters.reduce((total, chapter) => total + chapter.candidates.length, 0)

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
    expect(candidateCount).toBeGreaterThan(3000)
  })

  it('contains hierarchical candidate memberships for substituted tokens', () => {
    const tokens = fixture.work.volumes[0].chapters.flatMap((chapter) =>
      chapter.paragraphs.flatMap((paragraph) => paragraph.segments.flatMap((segment) => segment.tokens)),
    )

    expect(tokens.some((token) => token.language === 'cs' && token.candidateIds.length > 1)).toBe(true)
  })

  it('keeps debug and admin controls hidden in the public reader', async () => {
    const user = userEvent.setup()
    const { container } = render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    expect(await screen.findByTestId('reader-screen')).toBeInTheDocument()
    expect(screen.queryByText('Token debug')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /pobierz moje poprawki json/i })).not.toBeInTheDocument()
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

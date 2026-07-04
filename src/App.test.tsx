import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import fixture from '../public/data/fixtures/szwejk-mini/reader-fixture.json'

const response = new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } })

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

  it('loads a substantial real-text fixture instead of a tiny debug sample', () => {
    const chapter = fixture.work.volumes[0].chapters[0]

    expect(chapter.id).toBe('chapter-016')
    expect(chapter.paragraphs.length).toBeGreaterThan(50)
    expect(chapter.candidates.length).toBeGreaterThan(300)
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

  it('opens a reader popover with counterpart text and stores reading progress', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    const token = (await screen.findAllByTestId('reader-token'))[0]
    await user.click(token)

    expect(await screen.findByRole('dialog', { name: /równoległy tekst/i })).toBeInTheDocument()
    expect(screen.queryByText(/czeski odpowiednik/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/polski odpowiednik/i)).not.toBeInTheDocument()
    expect(screen.queryByText('Token debug')).not.toBeInTheDocument()

    await waitFor(() => {
      expect(localStorage.getItem('szwejk-reader.progress')).toContain('tokenId')
    })
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

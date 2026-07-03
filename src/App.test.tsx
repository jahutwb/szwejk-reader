import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import fixture from '../public/data/fixtures/szwejk-mini/reader-fixture.json'

const response = new Response(JSON.stringify(fixture), { status: 200, headers: { 'content-type': 'application/json' } })

describe('App', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response.clone()))
  })

  it('shows library, opens volume I, and displays reader fixture tokens', async () => {
    const user = userEvent.setup()
    render(<App />)

    expect(screen.getByText('Dobry wojak Szwejk')).toBeInTheDocument()
    expect(screen.getByText('Tom I')).toBeInTheDocument()
    expect(screen.getByText('Tom II')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    expect(await screen.findByTestId('reader-screen')).toBeInTheDocument()
    expect(screen.getAllByTestId('reader-token').length).toBeGreaterThan(0)
  })

  it('opens a token debug panel and stores reading progress', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /czytaj tom i/i }))

    const token = (await screen.findAllByTestId('reader-token'))[0]
    await user.click(token)

    expect(await screen.findByText('Token debug')).toBeInTheDocument()
    expect(screen.getByText(/token_id/i)).toBeInTheDocument()

    await waitFor(() => {
      expect(localStorage.getItem('szwejk-reader.progress')).toContain('tokenId')
    })
  })
})

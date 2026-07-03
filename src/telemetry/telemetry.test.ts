import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionId, logCorrectionEvent, logWordClick, submitOverrides } from './telemetry'
import type { ReaderOverride } from '@/domain/types'

describe('telemetry', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  it('creates and reuses an anonymous local session id', () => {
    const first = getSessionId()
    const second = getSessionId()

    expect(first).toMatch(/^sr_/)
    expect(second).toBe(first)
  })

  it('buffers word click and correction events locally', () => {
    logWordClick({ workId: 'work', volumeId: 'vol', chapterId: 'ch', paragraphId: 'p', tokenId: 'tok', tokenText: 'Wielkie', language: 'pl', candidateIds: ['c1'], activeCandidateId: 'c1' })
    logCorrectionEvent({ workId: 'work', volumeId: 'vol', chapterId: 'ch', eventType: 'start', candidateId: 'c1' })

    const buffer = JSON.parse(localStorage.getItem('szwejk-reader.telemetry-buffer') ?? '[]')

    expect(buffer).toHaveLength(2)
    expect(buffer[0].collection).toBe('word_clicks')
    expect(buffer[1].collection).toBe('correction_events')
  })

  it('buffers override submissions and does not throw when network is unavailable', async () => {
    const overrides: ReaderOverride[] = [{ id: 'override-1', workId: 'work', volumeId: 'vol', chapterId: 'ch', createdAt: '2026-07-04T00:00:00.000Z', operations: [] }]

    await expect(submitOverrides(overrides, { endpoint: '/missing-endpoint' })).resolves.toEqual({ ok: false, queued: true })
  })
})

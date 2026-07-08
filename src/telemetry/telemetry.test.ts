import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { getSessionId, logCorrectionEvent, logWordClick, submitOverrides } from './telemetry'
import type { ReaderOverride } from '@/domain/types'

describe('telemetry', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    localStorage.clear()
    vi.spyOn(console, 'debug').mockImplementation(() => undefined)
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
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

  it('posts compact Site Data override records when an endpoint is configured', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      void input
      void init
      return Promise.resolve(new Response('{}', { status: 201, headers: { 'content-type': 'application/json' } }))
    })
    vi.stubGlobal('fetch', fetchMock)
    const overrides: ReaderOverride[] = [
      {
        id: 'feedback-1',
        workId: 'work',
        volumeId: 'vol',
        chapterId: 'ch',
        baseArtifactId: 'artifact-v13',
        createdAt: '2026-07-04T00:00:00.000Z',
        operations: [
          {
            type: 'token-feedback-flag',
            tokenId: 'tok',
            paragraphId: 'par',
            candidateId: 'cand',
            value: { note: 'Do poprawy', flagged: true },
          },
        ],
      },
    ]

    await expect(submitOverrides(overrides, { endpoint: './.herenow/data/override_submissions' })).resolves.toEqual({ ok: true, queued: false })

    const request = fetchMock.mock.calls[0]?.[1]
    if (!request) throw new Error('Expected submitOverrides to pass a RequestInit')
    const body = JSON.parse(String(request.body))
    expect(body).toMatchObject({
      work_id: 'work',
      volume_id: 'vol',
      chapter_id: 'ch',
      base_artifact_id: 'artifact-v13',
      override_patch_id: 'feedback-1',
      operation_count: 1,
      client_schema_version: 'reader-overrides-v1',
      pl_location_range: {
        chapter_id: 'ch',
        paragraph_id: 'par',
        token_id: 'tok',
        candidate_id: 'cand',
      },
    })
    expect(body.operations[0]).toMatchObject({ type: 'token-feedback-flag', overrideId: 'feedback-1' })
    expect(body.overrides).toBeUndefined()
    expect(body.override_count).toBeUndefined()
  })
})

import { describe, expect, it } from 'vitest'
import { validateReaderFixture } from './schemas'

const validFixture = {
  work: {
    id: 'work-szwejk',
    title: 'Dobry wojak Szwejk',
    slug: 'szwejk',
    volumes: [
      {
        id: 'vol-1',
        label: 'Tom I',
        status: 'available',
        chapters: [
          {
            id: 'ch-001',
            title: 'Rozdział testowy',
            paragraphs: [
              {
                id: 'p-1',
                segments: [
                  {
                    id: 'seg-1',
                    language: 'pl',
                    text: 'Wielkie czasy.',
                    tokens: [
                      { id: 'tok-1', text: 'Wielkie', language: 'pl', start: 0, end: 7, candidateIds: ['cand-1'] },
                    ],
                    candidateIds: ['cand-1'],
                  },
                ],
              },
            ],
            candidates: [
              { id: 'cand-1', type: 'paragraph', tokenIds: ['tok-1'], sourceTokenIds: ['tok-1'], targetTokenIds: [] },
            ],
            footnotes: [],
            glossary: [],
          },
        ],
      },
    ],
  },
  metadata: { sourceArtifactId: 'fixture-test', generatedAt: '2026-07-04T00:00:00.000Z' },
}

describe('validateReaderFixture', () => {
  it('accepts a minimal reader fixture with stable ids', () => {
    const result = validateReaderFixture(validFixture)

    expect(result.ok).toBe(true)
  })

  it('rejects fixtures without work id', () => {
    const invalid = structuredClone(validFixture)
    invalid.work.id = ''

    const result = validateReaderFixture(invalid)

    expect(result.ok).toBe(false)
  })
})

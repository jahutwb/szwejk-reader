import { describe, expect, it } from 'vitest'
import { splitTokenTextParts } from './textSegments'
import type { RenderSegment } from './types'

describe('splitTokenTextParts', () => {
  it('preserves source spacing around punctuation from token offsets', () => {
    const segment: RenderSegment = {
      id: 'seg-1',
      language: 'hybrid',
      text: 'Ahoj, świecie. Tak!',
      candidateIds: [],
      tokens: [
        { id: 'tok-1', text: 'Ahoj', language: 'cs', start: 0, end: 4, candidateIds: [] },
        { id: 'tok-2', text: ',', language: 'hybrid', start: 4, end: 5, candidateIds: [] },
        { id: 'tok-3', text: 'świecie', language: 'pl', start: 6, end: 13, candidateIds: [] },
        { id: 'tok-4', text: '.', language: 'hybrid', start: 13, end: 14, candidateIds: [] },
        { id: 'tok-5', text: 'Tak', language: 'pl', start: 15, end: 18, candidateIds: [] },
        { id: 'tok-6', text: '!', language: 'hybrid', start: 18, end: 19, candidateIds: [] },
      ],
    }

    const rebuilt = splitTokenTextParts(segment)
      .map((part) => part.text)
      .join('')

    expect(rebuilt).toBe(segment.text)
    expect(rebuilt).not.toMatch(/\s+[,.!?;:]/)
  })
})

import { describe, expect, it } from 'vitest'
import { findSmallestCandidateForToken } from './selection'
import type { Candidate } from './types'

const candidates: Candidate[] = [
  { id: 'paragraph', type: 'paragraph', tokenIds: ['a', 'b', 'c'], sourceTokenIds: ['a', 'b', 'c'], targetTokenIds: [] },
  { id: 'sentence', type: 'sentence', tokenIds: ['b', 'c'], sourceTokenIds: ['b', 'c'], targetTokenIds: [] },
  { id: 'word', type: 'token', tokenIds: ['b'], sourceTokenIds: ['b'], targetTokenIds: [] },
]

describe('findSmallestCandidateForToken', () => {
  it('returns the smallest candidate containing a token', () => {
    expect(findSmallestCandidateForToken(candidates, 'b')?.id).toBe('word')
  })

  it('returns undefined when no candidate contains a token', () => {
    expect(findSmallestCandidateForToken(candidates, 'missing')).toBeUndefined()
  })
})

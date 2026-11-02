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

  it('prefers token-level alignment when equally sized candidates overlap', () => {
    const paragraph = { ...candidates[0], tokenIds: ['b'] }
    expect(findSmallestCandidateForToken([paragraph, candidates[2]], 'b')?.id).toBe('word')
  })

  it('uses candidate IDs to resolve equal-size, equal-type ambiguity', () => {
    const left = { ...candidates[2], id: 'a' }
    const right = { ...candidates[2], id: 'z' }
    expect(findSmallestCandidateForToken([right, left], 'b')?.id).toBe('a')
    expect(findSmallestCandidateForToken([left, right], 'b')?.id).toBe('a')
  })

  it('preserves the caller’s candidates when looking up an overlapping token', () => {
    const original = structuredClone(candidates)
    findSmallestCandidateForToken(candidates, 'b')
    expect(candidates).toEqual(original)
  })
})

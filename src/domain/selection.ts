import type { Candidate } from './types'

const typeRank = (type: string): number => {
  switch (type) {
    case 'token':
      return 0
    case 'word':
      return 1
    case 'sentence':
      return 2
    case 'paragraph':
      return 3
    default:
      return 10
  }
}

export function findSmallestCandidateForToken(candidates: Candidate[], tokenId: string): Candidate | undefined {
  return candidates
    .filter((candidate) => candidate.tokenIds.includes(tokenId))
    .sort((left, right) => {
      const lengthDelta = left.tokenIds.length - right.tokenIds.length
      if (lengthDelta !== 0) return lengthDelta
      const rankDelta = typeRank(left.type) - typeRank(right.type)
      if (rankDelta !== 0) return rankDelta
      return left.id.localeCompare(right.id)
    })[0]
}

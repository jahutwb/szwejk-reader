import type { RenderSegment, Token } from './types'

export type TokenTextPart =
  | { kind: 'text'; key: string; text: string }
  | { kind: 'token'; key: string; text: string; token: Token }

export function splitTokenTextParts(segment: RenderSegment): TokenTextPart[] {
  const parts: TokenTextPart[] = []
  const tokens = [...segment.tokens].sort((left, right) => left.start - right.start || left.end - right.end)
  let cursor = 0

  tokens.forEach((token, index) => {
    const safeStart = Math.max(cursor, Math.min(token.start, segment.text.length))
    const safeEnd = Math.max(safeStart, Math.min(token.end, segment.text.length))

    if (safeStart > cursor) {
      parts.push({
        kind: 'text',
        key: `${segment.id}:text:${index}:${cursor}`,
        text: segment.text.slice(cursor, safeStart),
      })
    }

    parts.push({
      kind: 'token',
      key: token.id,
      text: segment.text.slice(safeStart, safeEnd) || token.text,
      token,
    })
    cursor = safeEnd
  })

  if (cursor < segment.text.length) {
    parts.push({
      kind: 'text',
      key: `${segment.id}:text:tail:${cursor}`,
      text: segment.text.slice(cursor),
    })
  }

  return parts
}

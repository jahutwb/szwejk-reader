import { parseReaderFixture, parseReaderPageMap } from '@/domain/schemas'
import type { ReaderFixture, ReaderPageMap } from '@/domain/types'

export async function loadMiniFixture(): Promise<ReaderFixture> {
  const response = await fetch('/data/fixtures/szwejk-mini/reader-fixture.json')
  if (!response.ok) {
    throw new Error(`Failed to load fixture: HTTP ${response.status}`)
  }
  return parseReaderFixture(await response.json())
}

export async function loadLatexPageMap(): Promise<ReaderPageMap | null> {
  const response = await fetch('/data/fixtures/szwejk-mini/page-map-latex-v13-volume-1.json')
  if (!response.ok) return null
  return parseReaderPageMap(await response.json())
}

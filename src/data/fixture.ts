import { parseReaderFixture } from '@/domain/schemas'
import type { ReaderFixture } from '@/domain/types'

export async function loadMiniFixture(): Promise<ReaderFixture> {
  const response = await fetch('/data/fixtures/szwejk-mini/reader-fixture.json')
  if (!response.ok) {
    throw new Error(`Failed to load fixture: HTTP ${response.status}`)
  }
  return parseReaderFixture(await response.json())
}

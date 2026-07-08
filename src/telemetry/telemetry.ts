import type { CorrectionEvent, ReaderOverride, OverrideSubmissionEvent, WordClickEvent } from '@/domain/types'

const SESSION_KEY = 'szwejk-reader.session-id'
const BUFFER_KEY = 'szwejk-reader.telemetry-buffer'
const OVERRIDE_SCHEMA_VERSION = 'reader-overrides-v1'

type SubmitResult = { ok: true; queued: boolean } | { ok: false; queued: true; error?: string }

type WordClickInput = {
  workId: string
  volumeId: string
  chapterId: string
  paragraphId: string
  tokenId: string
  tokenText: string
  language: string
  candidateIds: string[]
  activeCandidateId?: string
}

type CorrectionInput = {
  workId: string
  volumeId: string
  chapterId: string
  eventType: string
  candidateId?: string
  tokenId?: string
}

type OverrideSubmissionRecord = {
  session_id: string
  created_at_client: string
  work_id?: string
  volume_id?: string
  chapter_id?: string
  base_artifact_id?: string
  override_patch_id?: string
  pl_location_range?: Record<string, string | undefined>
  operations: unknown[]
  operation_count: number
  client_schema_version: string
}

const nowIso = () => new Date().toISOString()

function getStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  } catch {
    return undefined
  }
}

function createSessionId(): string {
  const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  return `sr_${random}`
}

export function getSessionId(): string {
  const storage = getStorage()
  if (!storage) return createSessionId()
  const existing = storage.getItem(SESSION_KEY)
  if (existing) return existing
  const next = createSessionId()
  storage.setItem(SESSION_KEY, next)
  return next
}

function readBuffer(): unknown[] {
  const storage = getStorage()
  if (!storage) return []
  try {
    const raw = storage.getItem(BUFFER_KEY)
    return raw ? (JSON.parse(raw) as unknown[]) : []
  } catch {
    return []
  }
}

function writeBuffer(items: unknown[]): void {
  const storage = getStorage()
  if (!storage) return
  try {
    storage.setItem(BUFFER_KEY, JSON.stringify(items.slice(-200)))
  } catch (error) {
    console.warn('telemetry buffer write failed', error)
  }
}

function enqueue(collection: string, payload: unknown): void {
  const items = readBuffer()
  const record = { collection, payload }
  items.push(record)
  writeBuffer(items)
  console.debug('szwejk-reader telemetry', record)
}

function createOverrideSubmissionRecord(event: OverrideSubmissionEvent, overrides: ReaderOverride[]): OverrideSubmissionRecord {
  const first = overrides[0]
  const firstOperation = first?.operations[0]
  const operations = overrides.flatMap((override) =>
    override.operations.map((operation) => ({
      ...operation,
      overrideId: override.id,
      createdAt: override.createdAt,
    })),
  )

  return {
    session_id: event.session_id,
    created_at_client: event.created_at_client,
    work_id: first?.workId,
    volume_id: first?.volumeId,
    chapter_id: first?.chapterId,
    base_artifact_id: first?.baseArtifactId,
    override_patch_id: first?.id,
    pl_location_range: firstOperation
      ? {
          chapter_id: first?.chapterId,
          paragraph_id: firstOperation.paragraphId,
          token_id: firstOperation.tokenId,
          candidate_id: firstOperation.candidateId,
        }
      : undefined,
    operations,
    operation_count: operations.length,
    client_schema_version: OVERRIDE_SCHEMA_VERSION,
  }
}

export function logWordClick(input: WordClickInput): WordClickEvent {
  const event: WordClickEvent = {
    collection: 'word_clicks',
    session_id: getSessionId(),
    created_at_client: nowIso(),
    work_id: input.workId,
    volume_id: input.volumeId,
    chapter_id: input.chapterId,
    paragraph_id: input.paragraphId,
    token_id: input.tokenId,
    token_text: input.tokenText,
    language: input.language,
    candidate_ids: input.candidateIds,
    active_candidate_id: input.activeCandidateId,
  }
  enqueue('word_clicks', event)
  return event
}

export function logCorrectionEvent(input: CorrectionInput): CorrectionEvent {
  const event: CorrectionEvent = {
    collection: 'correction_events',
    session_id: getSessionId(),
    created_at_client: nowIso(),
    work_id: input.workId,
    volume_id: input.volumeId,
    chapter_id: input.chapterId,
    event_type: input.eventType,
    candidate_id: input.candidateId,
    token_id: input.tokenId,
  }
  enqueue('correction_events', event)
  return event
}

export async function submitOverrides(
  overrides: ReaderOverride[],
  options: { endpoint?: string } = {},
): Promise<SubmitResult> {
  const first = overrides[0]
  const event: OverrideSubmissionEvent = {
    collection: 'override_submissions',
    session_id: getSessionId(),
    created_at_client: nowIso(),
    work_id: first?.workId,
    volume_id: first?.volumeId,
    chapter_id: first?.chapterId,
    override_count: overrides.length,
    overrides,
  }
  enqueue('override_submissions', event)

  if (!options.endpoint || typeof fetch !== 'function') {
    return { ok: true, queued: true }
  }

  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'idempotency-key': `${event.session_id}-${event.created_at_client}`,
      },
      body: JSON.stringify(createOverrideSubmissionRecord(event, overrides)),
    })
    if (!response.ok) return { ok: false, queued: true }
    return { ok: true, queued: false }
  } catch (error) {
    console.warn('override submission failed softly', error)
    return { ok: false, queued: true }
  }
}

export const telemetryStorageKeys = {
  session: SESSION_KEY,
  buffer: BUFFER_KEY,
}

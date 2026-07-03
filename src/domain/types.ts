export type LanguageCode = 'pl' | 'cs' | string
export type VolumeStatus = 'available' | 'locked' | 'soon'

export interface ReaderFixture {
  metadata: {
    sourceArtifactPath?: string
    sourceArtifactId?: string
    sourceParentUnitId?: string
    targetParentUnitId?: string
    generatedAt?: string
    fixtureKind?: string
    [key: string]: unknown
  }
  work: Work
}

export interface Work {
  id: string
  slug: string
  title: string
  sourceLanguage?: LanguageCode
  targetLanguage?: LanguageCode
  volumes: Volume[]
}

export interface Volume {
  id: string
  label: string
  status: VolumeStatus
  chapters: Chapter[]
}

export interface Chapter {
  id: string
  title: string
  paragraphs: Paragraph[]
  candidates: Candidate[]
  footnotes: Footnote[]
  glossary: GlossaryEntry[]
}

export interface Paragraph {
  id: string
  targetParagraphId?: string
  sourceUnitIds?: string[]
  targetUnitIds?: string[]
  segments: RenderSegment[]
}

export interface RenderSegment {
  id: string
  language: LanguageCode
  text: string
  tokens: Token[]
  candidateIds: string[]
}

export interface Token {
  id: string
  text: string
  language: LanguageCode
  start: number
  end: number
  candidateIds: string[]
}

export interface Candidate {
  id: string
  type: string
  tokenIds: string[]
  sourceTokenIds: string[]
  targetTokenIds: string[]
  sourceUnitIds?: string[]
  targetUnitIds?: string[]
  sourceText?: string
  targetText?: string
  score?: number | null
  parentId?: string | null
}

export interface Footnote {
  id: string
  marker?: string
  paragraphId?: string
  text: string
}

export interface GlossaryEntry {
  id: string
  term: string
  explanation: string
  language?: LanguageCode
}

export interface ReaderOverride {
  id: string
  workId: string
  volumeId: string
  chapterId: string
  baseArtifactId?: string
  createdAt: string
  operations: ReaderOverrideOperation[]
}

export interface ReaderOverrideOperation {
  type?: string
  tokenId?: string
  candidateId?: string
  paragraphId?: string
  value?: unknown
  [key: string]: unknown
}

export type ReaderEvent = WordClickEvent | CorrectionEvent | OverrideSubmissionEvent

export interface WordClickEvent {
  collection: 'word_clicks'
  session_id: string
  created_at_client: string
  work_id: string
  volume_id: string
  chapter_id: string
  paragraph_id: string
  token_id: string
  token_text: string
  language: LanguageCode
  candidate_ids: string[]
  active_candidate_id?: string
}

export interface CorrectionEvent {
  collection: 'correction_events'
  session_id: string
  created_at_client: string
  work_id: string
  volume_id: string
  chapter_id: string
  event_type: string
  candidate_id?: string
  token_id?: string
}

export interface OverrideSubmissionEvent {
  collection: 'override_submissions'
  session_id: string
  created_at_client: string
  work_id?: string
  volume_id?: string
  chapter_id?: string
  override_count: number
  overrides: ReaderOverride[]
}

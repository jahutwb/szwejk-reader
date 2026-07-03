import type { Candidate, Chapter, Paragraph, ReaderFixture, RenderSegment, Token, Volume, Work } from './types'

export type ValidationResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isNonEmptyString = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0
const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

function validateToken(value: unknown, path: string, errors: string[]): value is Token {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id is required`)
  if (typeof value.text !== 'string') errors.push(`${path}.text must be a string`)
  if (!isNonEmptyString(value.language)) errors.push(`${path}.language is required`)
  if (typeof value.start !== 'number') errors.push(`${path}.start must be a number`)
  if (typeof value.end !== 'number') errors.push(`${path}.end must be a number`)
  if (!isStringArray(value.candidateIds)) errors.push(`${path}.candidateIds must be a string array`)
  return errors.length === 0 || isNonEmptyString(value.id)
}

function validateSegment(value: unknown, path: string, errors: string[]): value is RenderSegment {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id is required`)
  if (!isNonEmptyString(value.language)) errors.push(`${path}.language is required`)
  if (typeof value.text !== 'string') errors.push(`${path}.text must be a string`)
  if (!isStringArray(value.candidateIds)) errors.push(`${path}.candidateIds must be a string array`)
  if (!Array.isArray(value.tokens)) {
    errors.push(`${path}.tokens must be an array`)
  } else {
    value.tokens.forEach((token, index) => validateToken(token, `${path}.tokens[${index}]`, errors))
  }
  return isNonEmptyString(value.id)
}

function validateParagraph(value: unknown, path: string, errors: string[]): value is Paragraph {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id is required`)
  if (!Array.isArray(value.segments)) {
    errors.push(`${path}.segments must be an array`)
  } else {
    value.segments.forEach((segment, index) => validateSegment(segment, `${path}.segments[${index}]`, errors))
  }
  return isNonEmptyString(value.id)
}

function validateCandidate(value: unknown, path: string, errors: string[]): value is Candidate {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id is required`)
  if (!isNonEmptyString(value.type)) errors.push(`${path}.type is required`)
  if (!isStringArray(value.tokenIds)) errors.push(`${path}.tokenIds must be a string array`)
  if (!isStringArray(value.sourceTokenIds)) errors.push(`${path}.sourceTokenIds must be a string array`)
  if (!isStringArray(value.targetTokenIds)) errors.push(`${path}.targetTokenIds must be a string array`)
  return isNonEmptyString(value.id)
}

function validateChapter(value: unknown, path: string, errors: string[]): value is Chapter {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id is required`)
  if (!isNonEmptyString(value.title)) errors.push(`${path}.title is required`)
  if (!Array.isArray(value.paragraphs)) {
    errors.push(`${path}.paragraphs must be an array`)
  } else {
    value.paragraphs.forEach((paragraph, index) => validateParagraph(paragraph, `${path}.paragraphs[${index}]`, errors))
  }
  if (!Array.isArray(value.candidates)) {
    errors.push(`${path}.candidates must be an array`)
  } else {
    value.candidates.forEach((candidate, index) => validateCandidate(candidate, `${path}.candidates[${index}]`, errors))
  }
  if (!Array.isArray(value.footnotes)) errors.push(`${path}.footnotes must be an array`)
  if (!Array.isArray(value.glossary)) errors.push(`${path}.glossary must be an array`)
  return isNonEmptyString(value.id)
}

function validateVolume(value: unknown, path: string, errors: string[]): value is Volume {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id is required`)
  if (!isNonEmptyString(value.label)) errors.push(`${path}.label is required`)
  if (!['available', 'locked', 'soon'].includes(String(value.status))) errors.push(`${path}.status is invalid`)
  if (!Array.isArray(value.chapters)) {
    errors.push(`${path}.chapters must be an array`)
  } else {
    value.chapters.forEach((chapter, index) => validateChapter(chapter, `${path}.chapters[${index}]`, errors))
  }
  return isNonEmptyString(value.id)
}

function validateWork(value: unknown, path: string, errors: string[]): value is Work {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`)
    return false
  }
  if (!isNonEmptyString(value.id)) errors.push(`${path}.id is required`)
  if (!isNonEmptyString(value.slug)) errors.push(`${path}.slug is required`)
  if (!isNonEmptyString(value.title)) errors.push(`${path}.title is required`)
  if (!Array.isArray(value.volumes)) {
    errors.push(`${path}.volumes must be an array`)
  } else {
    value.volumes.forEach((volume, index) => validateVolume(volume, `${path}.volumes[${index}]`, errors))
  }
  return isNonEmptyString(value.id)
}

export function validateReaderFixture(input: unknown): ValidationResult<ReaderFixture> {
  const errors: string[] = []
  if (!isRecord(input)) {
    return { ok: false, errors: ['fixture must be an object'] }
  }
  if (!isRecord(input.metadata)) errors.push('metadata must be an object')
  validateWork(input.work, 'work', errors)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, data: input as unknown as ReaderFixture }
}

export function parseReaderFixture(input: unknown): ReaderFixture {
  const result = validateReaderFixture(input)
  if (!result.ok) {
    throw new Error(`Invalid reader fixture: ${result.errors.join('; ')}`)
  }
  return result.data
}

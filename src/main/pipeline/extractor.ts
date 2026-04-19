import type { NormalizedMessage } from '../../shared/types'

const PATTERNS: Record<string, RegExp> = {
  date: /\b(\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\b/g,
  amount: /\$[\d,]+\.?\d{0,2}\b/g,
  phone: /\b(\+?1?\s*[-.]?\s*\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4})\b/g,
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
  url: /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
}

export function extractData(
  message: NormalizedMessage,
  fields: string[]
): Record<string, string[]> {
  const text = `${message.subject}\n${message.body_text}`
  const result: Record<string, string[]> = {}

  for (const field of fields) {
    const pattern = PATTERNS[field]
    if (!pattern) continue

    const matches = text.match(new RegExp(pattern.source, pattern.flags))
    if (matches) {
      result[field] = [...new Set(matches)]
    }
  }

  return result
}

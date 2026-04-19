import { minimatch } from 'minimatch'
import type {
  NormalizedMessage,
  Rule,
  RuleCondition,
  RuleAction
} from '../../shared/types'

export interface RuleMatch {
  rule: Rule
  actions: RuleAction[]
}

export function evaluateRules(
  message: NormalizedMessage,
  rules: Rule[]
): RuleMatch[] {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority)
  const matches: RuleMatch[] = []

  for (const rule of sorted) {
    if (!rule.enabled) continue
    if (evaluateConditions(message, rule.conditions)) {
      matches.push({ rule, actions: rule.actions })
    }
  }

  return matches
}

function evaluateConditions(
  message: NormalizedMessage,
  conditions: Rule['conditions']
): boolean {
  const { combinator, items } = conditions

  switch (combinator) {
    case 'all':
      return items.every((c) => evaluateCondition(message, c))
    case 'any':
      return items.some((c) => evaluateCondition(message, c))
    case 'none':
      return !items.some((c) => evaluateCondition(message, c))
  }
}

function evaluateCondition(
  message: NormalizedMessage,
  condition: RuleCondition
): boolean {
  const fieldValue = resolveField(message, condition.field)

  switch (condition.op) {
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null && fieldValue !== ''

    case 'equals':
      return String(fieldValue) === condition.value

    case 'contains':
      return String(fieldValue ?? '')
        .toLowerCase()
        .includes((condition.value ?? '').toLowerCase())

    case 'matches':
      return minimatch(String(fieldValue ?? ''), condition.value ?? '', {
        nocase: true
      })

    case 'regex': {
      try {
        const re = new RegExp(condition.value ?? '', 'i')
        return re.test(String(fieldValue ?? ''))
      } catch {
        return false
      }
    }

    case 'has_type': {
      if (condition.field !== 'attachments') return false
      return message.attachments.some(
        (a) => a.mime_type === condition.value
      )
    }

    default:
      return false
  }
}

function resolveField(message: NormalizedMessage, field: string): unknown {
  const parts = field.split('.')
  let current: any = message

  for (const part of parts) {
    if (current === null || current === undefined) return undefined
    current = current[part]
  }

  return current
}

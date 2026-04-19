import { randomUUID } from 'crypto'
import { db } from '../database'
import { getConnector } from '../connectors'
import { evaluateRules } from './rules'
import { extractData } from './extractor'
import { pluginManager } from '../plugins/manager'
import type {
  EmailAccount,
  ProcessedMessage,
  AuditEntry,
  NormalizedMessage
} from '../../shared/types'

export interface PipelineResult {
  processed: number
  errors: number
}

export async function runPipeline(accountId?: string): Promise<PipelineResult> {
  const accounts = accountId
    ? [await db.getAccount(accountId)].filter(Boolean) as EmailAccount[]
    : await db.listAccounts()

  let processed = 0
  let errors = 0

  for (const account of accounts) {
    if (!account.enabled) continue

    try {
      const result = await processAccount(account)
      processed += result.processed
      errors += result.errors
    } catch (err) {
      errors++
      await audit('error', undefined, account.account_id, {
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  return { processed, errors }
}

async function processAccount(account: EmailAccount): Promise<PipelineResult> {
  const connector = getConnector(account.provider)
  const { messages, newCursor } = await connector.fetchMessages(account)

  let processed = 0
  let errors = 0
  const rules = await db.listRules()

  for (const message of messages) {
    try {
      // Step 1: Dedup
      if (await db.hasMessage(message.message_id)) continue

      await audit('message_received', message.message_id, account.account_id, {
        subject: message.subject,
        from: message.from_address
      })

      // Step 2: Rule engine
      const matches = evaluateRules(message, rules)
      const tags: string[] = []
      const routeTargets: string[] = []
      const extractFields: string[] = []

      for (const match of matches) {
        await audit('rule_matched', message.message_id, account.account_id, {
          rule: match.rule.name
        })

        for (const action of match.actions) {
          switch (action.type) {
            case 'tag':
              tags.push(action.value as string)
              break
            case 'route_to':
              routeTargets.push(action.value as string)
              break
            case 'extract':
              extractFields.push(...(Array.isArray(action.value) ? action.value : [action.value]))
              break
          }
        }
      }

      // Step 3: Attachments (Phase 2)
      // Step 4: Data extraction
      const extractedData: Record<string, unknown> = extractFields.length > 0
        ? extractData(message, extractFields)
        : {}

      // Step 5: LLM (Phase 4)

      // Build processed message before plugins (plugins can enrich it)
      const processedMessage: ProcessedMessage = {
        ...message,
        processed_at: new Date().toISOString(),
        tags: [...new Set(tags)],
        matched_rules: matches.map((m) => m.rule.name),
        extracted_data: extractedData,
        routed_to: routeTargets,
        is_read: false,
        is_starred: false,
        is_draft: false
      }

      // Step 5.5: Processor plugins
      const pluginResults = await pluginManager.processMessage(processedMessage)
      for (const result of pluginResults) {
        if (result.tags_added) {
          processedMessage.tags.push(...result.tags_added)
        }
        if (result.tags_removed) {
          processedMessage.tags = processedMessage.tags.filter(
            (t) => !result.tags_removed!.includes(t)
          )
        }
        if (result.extracted_data) {
          Object.assign(processedMessage.extracted_data, result.extracted_data)
        }
      }

      processedMessage.tags = [...new Set(processedMessage.tags)]
      await db.saveMessage(processedMessage)

      // Step 6: Route to action plugins
      for (const target of routeTargets) {
        try {
          await pluginManager.dispatchToAction(target, processedMessage)
          await audit('agent_notified', message.message_id, account.account_id, {
            agent: target
          })
        } catch (err) {
          await audit('error', message.message_id, account.account_id, {
            agent: target,
            error: err instanceof Error ? err.message : String(err)
          })
        }
      }

      processed++
    } catch (err) {
      errors++
      await audit('error', message.message_id, account.account_id, {
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  if (newCursor) {
    await db.updateSyncCursor(account.account_id, newCursor)
  }

  return { processed, errors }
}

async function audit(
  event: AuditEntry['event'],
  messageId: string | undefined,
  accountId: string | undefined,
  details: Record<string, unknown>
): Promise<void> {
  await db.appendAudit({
    entry_id: randomUUID(),
    timestamp: new Date().toISOString(),
    event,
    message_id: messageId,
    account_id: accountId,
    details
  })
}

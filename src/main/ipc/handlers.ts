import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { db } from '../database'
import { getConnector } from '../connectors'
import { runPipeline } from '../pipeline'
import type { EmailAccount, Rule, ComposeMessage } from '../../shared/types'

export function registerIpcHandlers(): void {
  // --- Accounts ---

  ipcMain.handle('accounts:list', async () => {
    return db.listAccounts()
  })

  ipcMain.handle('accounts:add', async (_event, account: Omit<EmailAccount, 'account_id'>) => {
    const full: EmailAccount = { ...account, account_id: randomUUID() }
    await db.saveAccount(full)
    return full
  })

  ipcMain.handle('accounts:remove', async (_event, accountId: string) => {
    await db.deleteAccount(accountId)
  })

  ipcMain.handle('accounts:sync', async (_event, accountId: string) => {
    return runPipeline(accountId)
  })

  ipcMain.handle('accounts:folders', async (_event, accountId: string) => {
    const account = await db.getAccount(accountId)
    if (!account) return []
    const connector = getConnector(account.provider)
    return connector.getFolders(account)
  })

  // --- Messages: read ---

  ipcMain.handle('messages:list', async (_event, opts: {
    accountId?: string
    folderId?: string
    limit?: number
    offset?: number
  }) => {
    return db.listMessages(opts)
  })

  ipcMain.handle('messages:search', async (_event, query: string) => {
    return db.searchMessages(query)
  })

  ipcMain.handle('messages:get', async (_event, messageId: string) => {
    return db.getMessage(messageId)
  })

  ipcMain.handle('messages:thread', async (_event, threadId: string) => {
    return db.getThread(threadId)
  })

  // --- Messages: manage ---

  ipcMain.handle('messages:markRead', async (_event, messageIds: string[], read: boolean) => {
    await db.updateMessageFlags(messageIds, { is_read: read })
    await forEachAccountGroup(messageIds, (connector, account, ids) =>
      connector.markRead(account, ids, read)
    )
  })

  ipcMain.handle('messages:star', async (_event, messageIds: string[], starred: boolean) => {
    await db.updateMessageFlags(messageIds, { is_starred: starred })
    await forEachAccountGroup(messageIds, (connector, account, ids) =>
      connector.star(account, ids, starred)
    )
  })

  ipcMain.handle('messages:archive', async (_event, messageIds: string[]) => {
    await forEachAccountGroup(messageIds, (connector, account, ids) =>
      connector.archive(account, ids)
    )
  })

  ipcMain.handle('messages:trash', async (_event, messageIds: string[]) => {
    await forEachAccountGroup(messageIds, (connector, account, ids) =>
      connector.trash(account, ids)
    )
    await db.deleteMessages(messageIds)
  })

  ipcMain.handle('messages:move', async (_event, messageIds: string[], folderId: string) => {
    await forEachAccountGroup(messageIds, (connector, account, ids) =>
      connector.moveToFolder(account, ids, folderId)
    )
  })

  ipcMain.handle('messages:addLabels', async (_event, messageIds: string[], labels: string[]) => {
    await forEachAccountGroup(messageIds, (connector, account, ids) =>
      connector.addLabels(account, ids, labels)
    )
  })

  ipcMain.handle('messages:removeLabels', async (_event, messageIds: string[], labels: string[]) => {
    await forEachAccountGroup(messageIds, (connector, account, ids) =>
      connector.removeLabels(account, ids, labels)
    )
  })

  // --- Compose (user-initiated only — never called by pipeline/agents) ---

  ipcMain.handle('compose:send', async (_event, accountId: string, message: ComposeMessage) => {
    const account = await db.getAccount(accountId)
    if (!account) throw new Error(`Account ${accountId} not found`)

    const connector = getConnector(account.provider)
    const sentId = await connector.sendMessage(account, message)

    await db.appendAudit({
      entry_id: randomUUID(),
      timestamp: new Date().toISOString(),
      event: 'message_sent',
      account_id: accountId,
      details: {
        origin: 'user',
        to: message.to,
        subject: message.subject,
        sent_id: sentId
      }
    })

    return sentId
  })

  ipcMain.handle('compose:saveDraft', async (_event, accountId: string, message: ComposeMessage) => {
    const account = await db.getAccount(accountId)
    if (!account) throw new Error(`Account ${accountId} not found`)

    const connector = getConnector(account.provider)
    return connector.saveDraft(account, message)
  })

  // --- Rules ---

  ipcMain.handle('rules:list', async () => {
    return db.listRules()
  })

  ipcMain.handle('rules:upsert', async (_event, rule: Rule) => {
    if (!rule.rule_id) rule.rule_id = randomUUID()
    await db.saveRule(rule)
    return rule
  })

  ipcMain.handle('rules:delete', async (_event, ruleId: string) => {
    await db.deleteRule(ruleId)
  })

  // --- Pipeline ---

  ipcMain.handle('pipeline:run', async (_event, accountId?: string) => {
    return runPipeline(accountId)
  })
}

async function forEachAccountGroup(
  messageIds: string[],
  action: (connector: any, account: EmailAccount, ids: string[]) => Promise<void>
): Promise<void> {
  const byAccount = new Map<string, string[]>()

  for (const id of messageIds) {
    const msg = await db.getMessage(id)
    if (!msg) continue
    const existing = byAccount.get(msg.account_id) ?? []
    existing.push(id)
    byAccount.set(msg.account_id, existing)
  }

  for (const [accountId, ids] of byAccount) {
    const account = await db.getAccount(accountId)
    if (!account) continue
    const connector = getConnector(account.provider)
    await action(connector, account, ids)
  }
}

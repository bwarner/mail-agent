import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { db } from '../database'
import { runPipeline } from '../pipeline'
import type { EmailAccount, Rule } from '../../shared/types'

export function registerIpcHandlers(): void {
  // --- Accounts ---

  ipcMain.handle('accounts:list', async () => {
    return db.listAccounts()
  })

  ipcMain.handle('accounts:add', async (_event, account: Omit<EmailAccount, 'account_id'>) => {
    const full: EmailAccount = {
      ...account,
      account_id: randomUUID()
    }
    await db.saveAccount(full)
    return full
  })

  ipcMain.handle('accounts:remove', async (_event, accountId: string) => {
    await db.deleteAccount(accountId)
  })

  ipcMain.handle('accounts:sync', async (_event, accountId: string) => {
    return runPipeline(accountId)
  })

  // --- Messages ---

  ipcMain.handle('messages:list', async (_event, opts: {
    accountId?: string
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

  // --- Rules ---

  ipcMain.handle('rules:list', async () => {
    return db.listRules()
  })

  ipcMain.handle('rules:upsert', async (_event, rule: Rule) => {
    if (!rule.rule_id) {
      rule.rule_id = randomUUID()
    }
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

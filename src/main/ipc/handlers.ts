import { ipcMain } from 'electron'
import { randomUUID } from 'crypto'
import { db } from '../database'
import { getConnector } from '../connectors'
import { runPipeline } from '../pipeline'
import { pluginManager } from '../plugins/manager'
import { startGmailOAuth } from '../auth/gmail-auth'
import { startOutlookOAuth } from '../auth/outlook-auth'
import { isOAuthConfigured } from '../auth/oauth-config'
import { vault } from '../auth/vault'
import { generateEmbedding, prepareMessageText, configureEmbeddings, type EmbeddingProvider } from '../embeddings/service'
import { llmInfer, setActiveProvider, getActiveProvider } from '../llm/service'
import { storeLLMApiKey } from '../auth/token-store'
import type { LLMProviderConfig, EmailAccount, Rule, ComposeMessage, Provider } from '../../shared/types'

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

  // --- OAuth (PKCE — no client secret needed) ---

  ipcMain.handle('auth:providers', async () => {
    return {
      gmail: isOAuthConfigured('gmail'),
      outlook: isOAuthConfigured('outlook')
    }
  })

  ipcMain.handle('auth:startOAuth', async (_event, provider: Provider) => {
    let result: { email: string; displayName: string; accountId: string }

    if (provider === 'gmail') {
      result = await startGmailOAuth()
    } else if (provider === 'outlook') {
      result = await startOutlookOAuth()
    } else {
      throw new Error(`Unknown provider: ${provider}`)
    }

    const account: EmailAccount = {
      account_id: result.accountId,
      provider,
      email_address: result.email,
      display_name: result.displayName,
      enabled: true,
      sync_cursor: null,
      polling_interval_ms: 60_000,
      folder_filters: [],
      last_sync: null
    }

    await db.saveAccount(account)
    return account
  })

  // --- IMAP account setup (no OAuth — username/password) ---

  ipcMain.handle('auth:addImap', async (_event, config: {
    email: string
    displayName: string
    imapHost: string
    imapPort: number
    smtpHost: string
    smtpPort: number
    username: string
    password: string
    useTls: boolean
  }) => {
    const accountId = `imap:${config.email}`

    await vault.storeJSON(`imap_config:${accountId}`, {
      imap_host: config.imapHost,
      imap_port: config.imapPort,
      smtp_host: config.smtpHost,
      smtp_port: config.smtpPort,
      username: config.username,
      use_tls: config.useTls
    })
    await vault.store(`imap_password:${accountId}`, config.password)

    const connector = getConnector('imap')
    const account: EmailAccount = {
      account_id: accountId,
      provider: 'imap',
      email_address: config.email,
      display_name: config.displayName || config.email,
      enabled: true,
      sync_cursor: null,
      polling_interval_ms: 60_000,
      folder_filters: [],
      last_sync: null
    }

    const connected = await connector.testConnection(account)
    if (!connected) {
      await vault.remove(`imap_config:${accountId}`)
      await vault.remove(`imap_password:${accountId}`)
      throw new Error('Connection failed — check server, port, and credentials')
    }

    await db.saveAccount(account)
    return account
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

  ipcMain.handle('messages:semanticSearch', async (_event, query: string) => {
    const embedding = await generateEmbedding(query)
    if (!embedding) return db.searchMessages(query)
    return db.semanticSearch(embedding)
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

  // --- Plugins ---

  ipcMain.handle('plugins:list', async () => {
    return pluginManager.listPlugins()
  })

  ipcMain.handle('plugins:enable', async (_event, name: string) => {
    await pluginManager.startPlugin(name)
  })

  ipcMain.handle('plugins:disable', async (_event, name: string) => {
    await pluginManager.stopPlugin(name)
  })

  ipcMain.handle('plugins:configure', async (_event, name: string, config: Record<string, unknown>) => {
    await pluginManager.configurePlugin(name, config)
  })

  ipcMain.handle('plugins:reload', async () => {
    await pluginManager.reload()
  })

  // --- Embeddings ---

  ipcMain.handle('embeddings:configure', async (_event, provider: EmbeddingProvider) => {
    configureEmbeddings(provider)
  })

  ipcMain.handle('embeddings:backfill', async () => {
    const messages = await db.getUnembeddedMessages(100)
    let embedded = 0
    for (const msg of messages) {
      const embedding = await generateEmbedding(prepareMessageText(msg))
      if (embedding) {
        await db.saveEmbedding(msg.message_id, embedding)
        embedded++
      }
    }
    return { embedded, remaining: await db.countUnembeddedMessages() }
  })

  ipcMain.handle('embeddings:stats', async () => {
    const unembedded = await db.countUnembeddedMessages()
    return { unembedded }
  })

  // --- Audit Log ---

  ipcMain.handle('audit:list', async (_event, opts: {
    limit?: number; offset?: number; event?: string; accountId?: string; messageId?: string
  }) => {
    return db.listAuditLog(opts)
  })

  ipcMain.handle('audit:count', async (_event, event?: string) => {
    return db.countAuditLog(event)
  })

  // --- Vault info ---

  ipcMain.handle('vault:status', async () => {
    const { vault: v } = await import('../auth/vault')
    const keys = await db.vaultList()
    return {
      encryptionAvailable: v.isEncryptionAvailable(),
      storedKeys: keys.length
    }
  })

  // --- LLM ---

  ipcMain.handle('llm:listProviders', async () => {
    return db.listLLMProviders()
  })

  ipcMain.handle('llm:saveProvider', async (_event, provider: LLMProviderConfig) => {
    if (provider.api_key_ref) {
      await storeLLMApiKey(provider.provider_id, provider.api_key_ref)
      provider.api_key_ref = `vault:llm_key:${provider.provider_id}`
    }
    await db.saveLLMProvider(provider)
    if (provider.enabled) await setActiveProvider(provider)
    return provider
  })

  ipcMain.handle('llm:setActive', async (_event, providerId: string) => {
    const providers = await db.listLLMProviders()
    const provider = providers.find((p) => p.provider_id === providerId)
    if (provider) await setActiveProvider(provider)
  })

  ipcMain.handle('llm:test', async (_event, providerId: string) => {
    const providers = await db.listLLMProviders()
    const provider = providers.find((p) => p.provider_id === providerId)
    if (!provider) throw new Error('Provider not found')

    const prev = getActiveProvider()
    await setActiveProvider(provider)
    try {
      const result = await llmInfer({ prompt: 'Say "hello" in one word.', maxTokens: 10 })
      return { success: true, response: result.text }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    } finally {
      if (prev) await setActiveProvider(prev)
    }
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

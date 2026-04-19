import { app } from 'electron'
import type {
  ProcessedMessage,
  EmailAccount,
  Rule,
  AuditEntry,
  AgentRegistration,
  LLMProviderConfig
} from '../shared/types'
import type { PluginInfo } from '../shared/plugin-types'

let CouchbaseLite: typeof import('@couchbase/lite-js')
let db: any

const COLLECTIONS = [
  'messages', 'attachments', 'rules', 'accounts',
  'audit_log', 'agents', 'plugins', 'plugin_storage', 'llm_providers'
] as const

type CollectionName = (typeof COLLECTIONS)[number]

export class Database {
  private database: any
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) return

    const fakeIdb = await import('fake-indexeddb')
    CouchbaseLite = await import('@couchbase/lite-js')

    CouchbaseLite.Database.useIndexedDB(fakeIdb.indexedDB, fakeIdb.IDBKeyRange)

    const collectionsConfig: Record<string, {}> = {}
    for (const name of COLLECTIONS) {
      collectionsConfig[name] = {}
    }

    this.database = await CouchbaseLite.Database.open({
      name: 'mail_agent',
      version: 1,
      collections: collectionsConfig
    })

    this.initialized = true
  }

  private col(name: CollectionName): any {
    return this.database.collections[name]
  }

  // --- Messages ---

  async saveMessage(message: ProcessedMessage): Promise<void> {
    const col = this.col('messages')
    await col.save({ _id: message.message_id, ...message })
  }

  async getMessage(messageId: string): Promise<ProcessedMessage | null> {
    const col = this.col('messages')
    try {
      const doc = await col.getDocument(messageId)
      return doc ? (doc as ProcessedMessage) : null
    } catch {
      return null
    }
  }

  async hasMessage(messageId: string): Promise<boolean> {
    return (await this.getMessage(messageId)) !== null
  }

  async listMessages(opts: {
    accountId?: string
    folderId?: string
    limit?: number
    offset?: number
  }): Promise<ProcessedMessage[]> {
    const { accountId, limit = 50, offset = 0 } = opts
    let query: string
    if (accountId) {
      query = `SELECT * FROM messages WHERE account_id = '${accountId}' ORDER BY date DESC LIMIT ${limit} OFFSET ${offset}`
    } else {
      query = `SELECT * FROM messages ORDER BY date DESC LIMIT ${limit} OFFSET ${offset}`
    }
    try {
      const q = this.database.createQuery(query)
      const results = await q.run()
      return results as ProcessedMessage[]
    } catch {
      return []
    }
  }

  async searchMessages(queryText: string): Promise<ProcessedMessage[]> {
    try {
      const escaped = queryText.replace(/'/g, "''")
      const q = this.database.createQuery(
        `SELECT * FROM messages WHERE subject LIKE '%${escaped}%' OR body_text LIKE '%${escaped}%' ORDER BY date DESC LIMIT 100`
      )
      const results = await q.run()
      return results as ProcessedMessage[]
    } catch {
      return []
    }
  }

  async getThread(threadId: string): Promise<ProcessedMessage[]> {
    try {
      const escaped = threadId.replace(/'/g, "''")
      const q = this.database.createQuery(
        `SELECT * FROM messages WHERE thread_id = '${escaped}' ORDER BY date ASC`
      )
      const results = await q.run()
      return results as ProcessedMessage[]
    } catch {
      return []
    }
  }

  async updateMessageFlags(
    messageIds: string[],
    flags: Partial<Pick<ProcessedMessage, 'is_read' | 'is_starred'>>
  ): Promise<void> {
    const col = this.col('messages')
    for (const id of messageIds) {
      const doc = await this.getMessage(id)
      if (!doc) continue
      const updated = { ...doc, ...flags }
      await col.save({ _id: id, ...updated })
    }
  }

  async deleteMessages(messageIds: string[]): Promise<void> {
    const col = this.col('messages')
    for (const id of messageIds) {
      try {
        await col.deleteDocument(id)
      } catch {}
    }
  }

  // --- Accounts ---

  async saveAccount(account: EmailAccount): Promise<void> {
    const col = this.col('accounts')
    await col.save({ _id: account.account_id, ...account })
  }

  async getAccount(accountId: string): Promise<EmailAccount | null> {
    const col = this.col('accounts')
    try {
      const doc = await col.getDocument(accountId)
      return doc ? (doc as EmailAccount) : null
    } catch {
      return null
    }
  }

  async listAccounts(): Promise<EmailAccount[]> {
    try {
      const q = this.database.createQuery(`SELECT * FROM accounts`)
      const results = await q.run()
      return results as EmailAccount[]
    } catch {
      return []
    }
  }

  async deleteAccount(accountId: string): Promise<void> {
    const col = this.col('accounts')
    try { await col.deleteDocument(accountId) } catch {}
  }

  async updateSyncCursor(accountId: string, cursor: string): Promise<void> {
    const account = await this.getAccount(accountId)
    if (!account) return
    account.sync_cursor = cursor
    account.last_sync = new Date().toISOString()
    await this.saveAccount(account)
  }

  // --- Rules ---

  async saveRule(rule: Rule): Promise<void> {
    const col = this.col('rules')
    await col.save({ _id: rule.rule_id, ...rule })
  }

  async listRules(): Promise<Rule[]> {
    try {
      const q = this.database.createQuery(
        `SELECT * FROM rules WHERE enabled = true ORDER BY priority ASC`
      )
      const results = await q.run()
      return results as Rule[]
    } catch {
      return []
    }
  }

  async deleteRule(ruleId: string): Promise<void> {
    const col = this.col('rules')
    try { await col.deleteDocument(ruleId) } catch {}
  }

  // --- Audit Log ---

  async appendAudit(entry: AuditEntry): Promise<void> {
    const col = this.col('audit_log')
    await col.save({ _id: entry.entry_id, ...entry })
  }

  // --- Agents ---

  async saveAgent(agent: AgentRegistration): Promise<void> {
    const col = this.col('agents')
    await col.save({ _id: agent.agent_id, ...agent })
  }

  async listAgents(): Promise<AgentRegistration[]> {
    try {
      const q = this.database.createQuery(`SELECT * FROM agents WHERE enabled = true`)
      const results = await q.run()
      return results as AgentRegistration[]
    } catch {
      return []
    }
  }

  // --- Plugins ---

  async savePlugin(plugin: PluginInfo): Promise<void> {
    const col = this.col('plugins')
    await col.save({ _id: plugin.manifest.name, ...plugin })
  }

  async getPlugin(name: string): Promise<PluginInfo | null> {
    const col = this.col('plugins')
    try {
      const doc = await col.getDocument(name)
      return doc ? (doc as PluginInfo) : null
    } catch {
      return null
    }
  }

  async listPlugins(): Promise<PluginInfo[]> {
    try {
      const q = this.database.createQuery(`SELECT * FROM plugins`)
      const results = await q.run()
      return results as PluginInfo[]
    } catch {
      return []
    }
  }

  async deletePlugin(name: string): Promise<void> {
    const col = this.col('plugins')
    try { await col.deleteDocument(name) } catch {}
  }

  // --- Plugin Storage ---

  async getPluginStorage(namespace: string, key: string): Promise<unknown> {
    const col = this.col('plugin_storage')
    const docId = `${namespace}:${key}`
    try {
      const doc = await col.getDocument(docId)
      return doc ? (doc as any).value : null
    } catch {
      return null
    }
  }

  async setPluginStorage(namespace: string, key: string, value: unknown): Promise<void> {
    const col = this.col('plugin_storage')
    const docId = `${namespace}:${key}`
    await col.save({ _id: docId, namespace, key, value })
  }

  async deletePluginStorage(namespace: string, key: string): Promise<void> {
    const col = this.col('plugin_storage')
    const docId = `${namespace}:${key}`
    try { await col.deleteDocument(docId) } catch {}
  }

  async listPluginStorage(namespace: string, prefix?: string): Promise<string[]> {
    try {
      const escaped = namespace.replace(/'/g, "''")
      const q = this.database.createQuery(
        `SELECT key FROM plugin_storage WHERE namespace = '${escaped}'`
      )
      const results = await q.run()
      const keys = results.map((r: any) => r.key as string)
      if (prefix) return keys.filter((k: string) => k.startsWith(prefix))
      return keys
    } catch {
      return []
    }
  }

  // --- LLM Providers ---

  async saveLLMProvider(provider: LLMProviderConfig): Promise<void> {
    const col = this.col('llm_providers')
    await col.save({ _id: provider.provider_id, ...provider })
  }

  async listLLMProviders(): Promise<LLMProviderConfig[]> {
    try {
      const q = this.database.createQuery(`SELECT * FROM llm_providers`)
      const results = await q.run()
      return results as LLMProviderConfig[]
    } catch {
      return []
    }
  }

  async close(): Promise<void> {
    if (this.database) {
      this.database.close()
      this.initialized = false
    }
  }
}

export const database = new Database()
export { database as db }

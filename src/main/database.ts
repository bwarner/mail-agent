import { app } from 'electron'
import { join } from 'path'
import type {
  ProcessedMessage,
  EmailAccount,
  Rule,
  AuditEntry,
  AgentRegistration,
  LLMProviderConfig
} from '../shared/types'

// Couchbase Lite JS types — imported at runtime
// Using dynamic import to handle native module loading in Electron
let cblite: typeof import('cblite-js')

const COLLECTION_NAMES = [
  'messages',
  'attachments',
  'rules',
  'accounts',
  'audit_log',
  'agents',
  'llm_providers'
] as const

type CollectionName = (typeof COLLECTION_NAMES)[number]

export class Database {
  private db: any
  private collections: Map<CollectionName, any> = new Map()
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) return

    cblite = await import('cblite-js')

    const dbDir = join(app.getPath('userData'), 'data')
    const config = new cblite.DatabaseConfiguration()
    config.directory = dbDir

    this.db = new cblite.Database('mail_agent', config)

    for (const name of COLLECTION_NAMES) {
      const collection = await this.db.createCollection(name, 'mail_agent')
      this.collections.set(name, collection)
    }

    await this.createIndexes()
    this.initialized = true
  }

  private async createIndexes(): Promise<void> {
    const messages = this.collection('messages')

    await messages.createIndex(
      'idx_messages_account',
      new cblite.ValueIndexConfiguration(['account_id', 'date'])
    )
    await messages.createIndex(
      'idx_messages_tags',
      new cblite.ValueIndexConfiguration(['tags'])
    )
    await messages.createIndex(
      'idx_messages_date',
      new cblite.ValueIndexConfiguration(['date'])
    )

    const auditLog = this.collection('audit_log')
    await auditLog.createIndex(
      'idx_audit_timestamp',
      new cblite.ValueIndexConfiguration(['timestamp'])
    )
  }

  private collection(name: CollectionName): any {
    const col = this.collections.get(name)
    if (!col) throw new Error(`Collection ${name} not initialized`)
    return col
  }

  // --- Messages ---

  async saveMessage(message: ProcessedMessage): Promise<void> {
    const col = this.collection('messages')
    const doc = new cblite.MutableDocument(message.message_id)
    doc.setData(message as unknown as Record<string, unknown>)
    await col.save(doc)
  }

  async getMessage(messageId: string): Promise<ProcessedMessage | null> {
    const col = this.collection('messages')
    const doc = await col.getDocument(messageId)
    if (!doc) return null
    return doc.toJSON() as ProcessedMessage
  }

  async hasMessage(messageId: string): Promise<boolean> {
    const doc = await this.getMessage(messageId)
    return doc !== null
  }

  async listMessages(opts: {
    accountId?: string
    limit?: number
    offset?: number
  }): Promise<ProcessedMessage[]> {
    const { accountId, limit = 50, offset = 0 } = opts
    const col = this.collection('messages')

    let query: any
    if (accountId) {
      query = this.db.createQuery(
        `SELECT * FROM mail_agent.messages WHERE account_id = $acct ORDER BY date DESC LIMIT $limit OFFSET $offset`
      )
      query.setParameters({ acct: accountId, limit, offset })
    } else {
      query = this.db.createQuery(
        `SELECT * FROM mail_agent.messages ORDER BY date DESC LIMIT $limit OFFSET $offset`
      )
      query.setParameters({ limit, offset })
    }

    const results = await query.execute()
    return results.map((row: any) => row.toJSON() as ProcessedMessage)
  }

  async searchMessages(queryText: string): Promise<ProcessedMessage[]> {
    const query = this.db.createQuery(
      `SELECT * FROM mail_agent.messages WHERE subject LIKE $q OR body_text LIKE $q ORDER BY date DESC LIMIT 100`
    )
    query.setParameters({ q: `%${queryText}%` })
    const results = await query.execute()
    return results.map((row: any) => row.toJSON() as ProcessedMessage)
  }

  // --- Accounts ---

  async saveAccount(account: EmailAccount): Promise<void> {
    const col = this.collection('accounts')
    const doc = new cblite.MutableDocument(account.account_id)
    doc.setData(account as unknown as Record<string, unknown>)
    await col.save(doc)
  }

  async getAccount(accountId: string): Promise<EmailAccount | null> {
    const col = this.collection('accounts')
    const doc = await col.getDocument(accountId)
    if (!doc) return null
    return doc.toJSON() as EmailAccount
  }

  async listAccounts(): Promise<EmailAccount[]> {
    const query = this.db.createQuery(
      `SELECT * FROM mail_agent.accounts ORDER BY email_address`
    )
    const results = await query.execute()
    return results.map((row: any) => row.toJSON() as EmailAccount)
  }

  async deleteAccount(accountId: string): Promise<void> {
    const col = this.collection('accounts')
    const doc = await col.getDocument(accountId)
    if (doc) await col.delete(doc)
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
    const col = this.collection('rules')
    const doc = new cblite.MutableDocument(rule.rule_id)
    doc.setData(rule as unknown as Record<string, unknown>)
    await col.save(doc)
  }

  async listRules(): Promise<Rule[]> {
    const query = this.db.createQuery(
      `SELECT * FROM mail_agent.rules WHERE enabled = true ORDER BY priority ASC`
    )
    const results = await query.execute()
    return results.map((row: any) => row.toJSON() as Rule)
  }

  async deleteRule(ruleId: string): Promise<void> {
    const col = this.collection('rules')
    const doc = await col.getDocument(ruleId)
    if (doc) await col.delete(doc)
  }

  // --- Audit Log ---

  async appendAudit(entry: AuditEntry): Promise<void> {
    const col = this.collection('audit_log')
    const doc = new cblite.MutableDocument(entry.entry_id)
    doc.setData(entry as unknown as Record<string, unknown>)
    await col.save(doc)
  }

  // --- Agents ---

  async saveAgent(agent: AgentRegistration): Promise<void> {
    const col = this.collection('agents')
    const doc = new cblite.MutableDocument(agent.agent_id)
    doc.setData(agent as unknown as Record<string, unknown>)
    await col.save(doc)
  }

  async listAgents(): Promise<AgentRegistration[]> {
    const query = this.db.createQuery(
      `SELECT * FROM mail_agent.agents WHERE enabled = true`
    )
    const results = await query.execute()
    return results.map((row: any) => row.toJSON() as AgentRegistration)
  }

  // --- LLM Providers ---

  async saveLLMProvider(provider: LLMProviderConfig): Promise<void> {
    const col = this.collection('llm_providers')
    const doc = new cblite.MutableDocument(provider.provider_id)
    doc.setData(provider as unknown as Record<string, unknown>)
    await col.save(doc)
  }

  async listLLMProviders(): Promise<LLMProviderConfig[]> {
    const query = this.db.createQuery(
      `SELECT * FROM mail_agent.llm_providers`
    )
    const results = await query.execute()
    return results.map((row: any) => row.toJSON() as LLMProviderConfig)
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close()
      this.initialized = false
    }
  }
}

export const db = new Database()

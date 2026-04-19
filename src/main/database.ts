import { app } from 'electron'
import { join } from 'path'
import { mkdirSync } from 'fs'
import { createClient, type Client } from '@libsql/client'
import type {
  ProcessedMessage,
  EmailAccount,
  Rule,
  AuditEntry,
  AgentRegistration,
  LLMProviderConfig
} from '../shared/types'
import type { PluginInfo } from '../shared/plugin-types'

export class Database {
  private client!: Client
  private initialized = false

  async init(): Promise<void> {
    if (this.initialized) return

    const dataDir = join(app.getPath('userData'), 'data')
    mkdirSync(dataDir, { recursive: true })

    const dbPath = join(dataDir, 'mail_agent.db')

    this.client = createClient({
      url: `file:${dbPath}`
    })

    await this.createTables()
    this.initialized = true
  }

  private async createTables(): Promise<void> {
    await this.client.executeMultiple(`
      CREATE TABLE IF NOT EXISTS messages (
        message_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        from_address TEXT NOT NULL,
        from_name TEXT DEFAULT '',
        "to" TEXT DEFAULT '[]',
        cc TEXT DEFAULT '[]',
        subject TEXT DEFAULT '',
        body_text TEXT DEFAULT '',
        body_html TEXT DEFAULT '',
        date TEXT NOT NULL,
        headers TEXT DEFAULT '{}',
        attachments TEXT DEFAULT '[]',
        labels TEXT DEFAULT '[]',
        thread_id TEXT DEFAULT '',
        in_reply_to TEXT DEFAULT '',
        processed_at TEXT,
        tags TEXT DEFAULT '[]',
        matched_rules TEXT DEFAULT '[]',
        extracted_data TEXT DEFAULT '{}',
        routed_to TEXT DEFAULT '[]',
        is_read INTEGER DEFAULT 0,
        is_starred INTEGER DEFAULT 0,
        is_draft INTEGER DEFAULT 0,
        embedding F32_BLOB(768)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_account ON messages(account_id, date);
      CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date);
      CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);

      CREATE TABLE IF NOT EXISTS accounts (
        account_id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        email_address TEXT NOT NULL,
        display_name TEXT DEFAULT '',
        enabled INTEGER DEFAULT 1,
        sync_cursor TEXT,
        polling_interval_ms INTEGER DEFAULT 60000,
        folder_filters TEXT DEFAULT '[]',
        last_sync TEXT
      );

      CREATE TABLE IF NOT EXISTS rules (
        rule_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        enabled INTEGER DEFAULT 1,
        conditions TEXT DEFAULT '{}',
        actions TEXT DEFAULT '[]',
        use_llm INTEGER DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        entry_id TEXT PRIMARY KEY,
        timestamp TEXT NOT NULL,
        event TEXT NOT NULL,
        message_id TEXT,
        account_id TEXT,
        details TEXT DEFAULT '{}'
      );

      CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp);

      CREATE TABLE IF NOT EXISTS agents (
        agent_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        method TEXT DEFAULT 'POST',
        auth TEXT DEFAULT '{}',
        retry TEXT DEFAULT '{}',
        timeout_seconds INTEGER DEFAULT 30,
        enabled INTEGER DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS plugins (
        name TEXT PRIMARY KEY,
        manifest TEXT NOT NULL,
        path TEXT NOT NULL,
        enabled INTEGER DEFAULT 0,
        config TEXT DEFAULT '{}',
        installed_at TEXT,
        error TEXT
      );

      CREATE TABLE IF NOT EXISTS plugin_storage (
        id TEXT PRIMARY KEY,
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_plugin_storage_ns ON plugin_storage(namespace);

      CREATE TABLE IF NOT EXISTS vault (
        key TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS llm_providers (
        provider_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        endpoint TEXT NOT NULL,
        model TEXT NOT NULL,
        api_key_ref TEXT,
        max_tokens INTEGER DEFAULT 4096,
        temperature REAL DEFAULT 0.7,
        enabled INTEGER DEFAULT 1
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
        subject, body_text, content=messages, content_rowid=rowid
      );
    `)
  }

  // --- Messages ---

  async saveMessage(message: ProcessedMessage): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO messages
            (message_id, account_id, provider, from_address, from_name,
             "to", cc, subject, body_text, body_html, date, headers,
             attachments, labels, thread_id, in_reply_to, processed_at,
             tags, matched_rules, extracted_data, routed_to,
             is_read, is_starred, is_draft)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        message.message_id, message.account_id, message.provider,
        message.from_address, message.from_name,
        JSON.stringify(message.to), JSON.stringify(message.cc),
        message.subject, message.body_text, message.body_html,
        message.date, JSON.stringify(message.headers),
        JSON.stringify(message.attachments), JSON.stringify(message.labels),
        message.thread_id, message.in_reply_to, message.processed_at,
        JSON.stringify(message.tags), JSON.stringify(message.matched_rules),
        JSON.stringify(message.extracted_data), JSON.stringify(message.routed_to),
        message.is_read ? 1 : 0, message.is_starred ? 1 : 0, message.is_draft ? 1 : 0
      ]
    })
  }

  private rowToMessage(row: any): ProcessedMessage {
    return {
      message_id: row.message_id,
      account_id: row.account_id,
      provider: row.provider,
      from_address: row.from_address,
      from_name: row.from_name,
      to: JSON.parse(row.to || '[]'),
      cc: JSON.parse(row.cc || '[]'),
      subject: row.subject,
      body_text: row.body_text,
      body_html: row.body_html,
      date: row.date,
      headers: JSON.parse(row.headers || '{}'),
      attachments: JSON.parse(row.attachments || '[]'),
      labels: JSON.parse(row.labels || '[]'),
      thread_id: row.thread_id,
      in_reply_to: row.in_reply_to,
      processed_at: row.processed_at,
      tags: JSON.parse(row.tags || '[]'),
      matched_rules: JSON.parse(row.matched_rules || '[]'),
      extracted_data: JSON.parse(row.extracted_data || '{}'),
      routed_to: JSON.parse(row.routed_to || '[]'),
      is_read: !!row.is_read,
      is_starred: !!row.is_starred,
      is_draft: !!row.is_draft
    }
  }

  async getMessage(messageId: string): Promise<ProcessedMessage | null> {
    const result = await this.client.execute({
      sql: 'SELECT * FROM messages WHERE message_id = ?',
      args: [messageId]
    })
    if (result.rows.length === 0) return null
    return this.rowToMessage(result.rows[0])
  }

  async hasMessage(messageId: string): Promise<boolean> {
    const result = await this.client.execute({
      sql: 'SELECT 1 FROM messages WHERE message_id = ?',
      args: [messageId]
    })
    return result.rows.length > 0
  }

  async listMessages(opts: {
    accountId?: string
    folderId?: string
    limit?: number
    offset?: number
  }): Promise<ProcessedMessage[]> {
    const { accountId, limit = 50, offset = 0 } = opts
    let result
    if (accountId) {
      result = await this.client.execute({
        sql: 'SELECT * FROM messages WHERE account_id = ? ORDER BY date DESC LIMIT ? OFFSET ?',
        args: [accountId, limit, offset]
      })
    } else {
      result = await this.client.execute({
        sql: 'SELECT * FROM messages ORDER BY date DESC LIMIT ? OFFSET ?',
        args: [limit, offset]
      })
    }
    return result.rows.map((row) => this.rowToMessage(row))
  }

  async searchMessages(queryText: string): Promise<ProcessedMessage[]> {
    const result = await this.client.execute({
      sql: `SELECT * FROM messages WHERE subject LIKE ? OR body_text LIKE ? ORDER BY date DESC LIMIT 100`,
      args: [`%${queryText}%`, `%${queryText}%`]
    })
    return result.rows.map((row) => this.rowToMessage(row))
  }

  async getThread(threadId: string): Promise<ProcessedMessage[]> {
    const result = await this.client.execute({
      sql: 'SELECT * FROM messages WHERE thread_id = ? ORDER BY date ASC',
      args: [threadId]
    })
    return result.rows.map((row) => this.rowToMessage(row))
  }

  async updateMessageFlags(
    messageIds: string[],
    flags: Partial<Pick<ProcessedMessage, 'is_read' | 'is_starred'>>
  ): Promise<void> {
    const sets: string[] = []
    const args: any[] = []
    if (flags.is_read !== undefined) {
      sets.push('is_read = ?')
      args.push(flags.is_read ? 1 : 0)
    }
    if (flags.is_starred !== undefined) {
      sets.push('is_starred = ?')
      args.push(flags.is_starred ? 1 : 0)
    }
    if (sets.length === 0) return

    const placeholders = messageIds.map(() => '?').join(',')
    args.push(...messageIds)
    await this.client.execute({
      sql: `UPDATE messages SET ${sets.join(', ')} WHERE message_id IN (${placeholders})`,
      args
    })
  }

  async deleteMessages(messageIds: string[]): Promise<void> {
    const placeholders = messageIds.map(() => '?').join(',')
    await this.client.execute({
      sql: `DELETE FROM messages WHERE message_id IN (${placeholders})`,
      args: messageIds
    })
  }

  // --- Vector Embeddings ---

  async saveEmbedding(messageId: string, embedding: Float32Array): Promise<void> {
    const vector = `[${Array.from(embedding).join(',')}]`
    await this.client.execute({
      sql: 'UPDATE messages SET embedding = vector32(?) WHERE message_id = ?',
      args: [vector, messageId]
    })
  }

  async semanticSearch(queryEmbedding: Float32Array, limit: number = 20): Promise<ProcessedMessage[]> {
    const vector = `[${Array.from(queryEmbedding).join(',')}]`
    const result = await this.client.execute({
      sql: `SELECT *, vector_distance_cos(embedding, vector32(?)) AS distance
            FROM messages
            WHERE embedding IS NOT NULL
            ORDER BY distance ASC
            LIMIT ?`,
      args: [vector, limit]
    })
    return result.rows.map((row) => this.rowToMessage(row))
  }

  async countUnembeddedMessages(): Promise<number> {
    const result = await this.client.execute(
      'SELECT COUNT(*) as cnt FROM messages WHERE embedding IS NULL'
    )
    return Number((result.rows[0] as any).cnt)
  }

  async getUnembeddedMessages(limit: number = 50): Promise<ProcessedMessage[]> {
    const result = await this.client.execute({
      sql: 'SELECT * FROM messages WHERE embedding IS NULL ORDER BY date DESC LIMIT ?',
      args: [limit]
    })
    return result.rows.map((row) => this.rowToMessage(row))
  }

  // --- Accounts ---

  async saveAccount(account: EmailAccount): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO accounts
            (account_id, provider, email_address, display_name, enabled,
             sync_cursor, polling_interval_ms, folder_filters, last_sync)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        account.account_id, account.provider, account.email_address,
        account.display_name, account.enabled ? 1 : 0,
        account.sync_cursor, account.polling_interval_ms,
        JSON.stringify(account.folder_filters), account.last_sync
      ]
    })
  }

  private rowToAccount(row: any): EmailAccount {
    return {
      account_id: row.account_id,
      provider: row.provider,
      email_address: row.email_address,
      display_name: row.display_name,
      enabled: !!row.enabled,
      sync_cursor: row.sync_cursor,
      polling_interval_ms: row.polling_interval_ms,
      folder_filters: JSON.parse(row.folder_filters || '[]'),
      last_sync: row.last_sync
    }
  }

  async getAccount(accountId: string): Promise<EmailAccount | null> {
    const result = await this.client.execute({
      sql: 'SELECT * FROM accounts WHERE account_id = ?',
      args: [accountId]
    })
    if (result.rows.length === 0) return null
    return this.rowToAccount(result.rows[0])
  }

  async listAccounts(): Promise<EmailAccount[]> {
    const result = await this.client.execute('SELECT * FROM accounts ORDER BY email_address')
    return result.rows.map((row) => this.rowToAccount(row))
  }

  async deleteAccount(accountId: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM accounts WHERE account_id = ?', args: [accountId] })
  }

  async updateSyncCursor(accountId: string, cursor: string): Promise<void> {
    await this.client.execute({
      sql: 'UPDATE accounts SET sync_cursor = ?, last_sync = ? WHERE account_id = ?',
      args: [cursor, new Date().toISOString(), accountId]
    })
  }

  // --- Rules ---

  async saveRule(rule: Rule): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO rules
            (rule_id, name, priority, enabled, conditions, actions, use_llm)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        rule.rule_id, rule.name, rule.priority, rule.enabled ? 1 : 0,
        JSON.stringify(rule.conditions), JSON.stringify(rule.actions),
        rule.use_llm ? 1 : 0
      ]
    })
  }

  async listRules(): Promise<Rule[]> {
    const result = await this.client.execute(
      'SELECT * FROM rules WHERE enabled = 1 ORDER BY priority ASC'
    )
    return result.rows.map((row: any) => ({
      rule_id: row.rule_id,
      name: row.name,
      priority: row.priority,
      enabled: !!row.enabled,
      conditions: JSON.parse(row.conditions || '{}'),
      actions: JSON.parse(row.actions || '[]'),
      use_llm: !!row.use_llm
    }))
  }

  async deleteRule(ruleId: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM rules WHERE rule_id = ?', args: [ruleId] })
  }

  // --- Audit Log ---

  async appendAudit(entry: AuditEntry): Promise<void> {
    await this.client.execute({
      sql: `INSERT INTO audit_log (entry_id, timestamp, event, message_id, account_id, details)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [
        entry.entry_id, entry.timestamp, entry.event,
        entry.message_id ?? null, entry.account_id ?? null,
        JSON.stringify(entry.details)
      ]
    })
  }

  // --- Agents ---

  async saveAgent(agent: AgentRegistration): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO agents
            (agent_id, name, endpoint, method, auth, retry, timeout_seconds, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        agent.agent_id, agent.name, agent.endpoint, agent.method,
        JSON.stringify(agent.auth), JSON.stringify(agent.retry),
        agent.timeout_seconds, agent.enabled ? 1 : 0
      ]
    })
  }

  async listAgents(): Promise<AgentRegistration[]> {
    const result = await this.client.execute('SELECT * FROM agents WHERE enabled = 1')
    return result.rows.map((row: any) => ({
      agent_id: row.agent_id,
      name: row.name,
      endpoint: row.endpoint,
      method: row.method,
      auth: JSON.parse(row.auth || '{}'),
      retry: JSON.parse(row.retry || '{}'),
      timeout_seconds: row.timeout_seconds,
      enabled: !!row.enabled
    }))
  }

  // --- Plugins ---

  async savePlugin(plugin: PluginInfo): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO plugins
            (name, manifest, path, enabled, config, installed_at, error)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        plugin.manifest.name, JSON.stringify(plugin.manifest),
        plugin.path, plugin.enabled ? 1 : 0,
        JSON.stringify(plugin.config), plugin.installed_at,
        plugin.error ?? null
      ]
    })
  }

  async getPlugin(name: string): Promise<PluginInfo | null> {
    const result = await this.client.execute({
      sql: 'SELECT * FROM plugins WHERE name = ?',
      args: [name]
    })
    if (result.rows.length === 0) return null
    const row = result.rows[0] as any
    return {
      manifest: JSON.parse(row.manifest),
      path: row.path,
      enabled: !!row.enabled,
      config: JSON.parse(row.config || '{}'),
      installed_at: row.installed_at,
      error: row.error ?? undefined
    }
  }

  async listPlugins(): Promise<PluginInfo[]> {
    const result = await this.client.execute('SELECT * FROM plugins')
    return result.rows.map((row: any) => ({
      manifest: JSON.parse(row.manifest),
      path: row.path,
      enabled: !!row.enabled,
      config: JSON.parse(row.config || '{}'),
      installed_at: row.installed_at,
      error: row.error ?? undefined
    }))
  }

  async deletePlugin(name: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM plugins WHERE name = ?', args: [name] })
  }

  // --- Plugin Storage ---

  async getPluginStorage(namespace: string, key: string): Promise<unknown> {
    const result = await this.client.execute({
      sql: 'SELECT value FROM plugin_storage WHERE namespace = ? AND key = ?',
      args: [namespace, key]
    })
    if (result.rows.length === 0) return null
    try { return JSON.parse((result.rows[0] as any).value) } catch { return null }
  }

  async setPluginStorage(namespace: string, key: string, value: unknown): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO plugin_storage (id, namespace, key, value)
            VALUES (?, ?, ?, ?)`,
      args: [`${namespace}:${key}`, namespace, key, JSON.stringify(value)]
    })
  }

  async deletePluginStorage(namespace: string, key: string): Promise<void> {
    await this.client.execute({
      sql: 'DELETE FROM plugin_storage WHERE namespace = ? AND key = ?',
      args: [namespace, key]
    })
  }

  async listPluginStorage(namespace: string, prefix?: string): Promise<string[]> {
    const result = await this.client.execute({
      sql: 'SELECT key FROM plugin_storage WHERE namespace = ?',
      args: [namespace]
    })
    const keys = result.rows.map((row: any) => row.key as string)
    if (prefix) return keys.filter((k) => k.startsWith(prefix))
    return keys
  }

  // --- LLM Providers ---

  async saveLLMProvider(provider: LLMProviderConfig): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO llm_providers
            (provider_id, name, type, endpoint, model, api_key_ref, max_tokens, temperature, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        provider.provider_id, provider.name, provider.type,
        provider.endpoint, provider.model, provider.api_key_ref ?? null,
        provider.max_tokens, provider.temperature, provider.enabled ? 1 : 0
      ]
    })
  }

  async listLLMProviders(): Promise<LLMProviderConfig[]> {
    const result = await this.client.execute('SELECT * FROM llm_providers')
    return result.rows.map((row: any) => ({
      provider_id: row.provider_id,
      name: row.name,
      type: row.type,
      endpoint: row.endpoint,
      model: row.model,
      api_key_ref: row.api_key_ref,
      max_tokens: row.max_tokens,
      temperature: row.temperature,
      enabled: !!row.enabled
    }))
  }

  // --- Vault (encrypted credential storage) ---

  async vaultSet(key: string, encryptedValue: string): Promise<void> {
    await this.client.execute({
      sql: `INSERT OR REPLACE INTO vault (key, encrypted_value, updated_at) VALUES (?, ?, datetime('now'))`,
      args: [key, encryptedValue]
    })
  }

  async vaultGet(key: string): Promise<string | null> {
    const result = await this.client.execute({
      sql: 'SELECT encrypted_value FROM vault WHERE key = ?',
      args: [key]
    })
    if (result.rows.length === 0) return null
    return (result.rows[0] as any).encrypted_value
  }

  async vaultDelete(key: string): Promise<void> {
    await this.client.execute({ sql: 'DELETE FROM vault WHERE key = ?', args: [key] })
  }

  async vaultList(prefix?: string): Promise<string[]> {
    const result = prefix
      ? await this.client.execute({ sql: "SELECT key FROM vault WHERE key LIKE ?", args: [`${prefix}%`] })
      : await this.client.execute('SELECT key FROM vault')
    return result.rows.map((row: any) => row.key)
  }

  // --- Audit Log Queries ---

  async listAuditLog(opts: {
    limit?: number
    offset?: number
    event?: string
    accountId?: string
    messageId?: string
  }): Promise<AuditEntry[]> {
    const { limit = 100, offset = 0, event, accountId, messageId } = opts
    const conditions: string[] = []
    const args: any[] = []

    if (event) { conditions.push('event = ?'); args.push(event) }
    if (accountId) { conditions.push('account_id = ?'); args.push(accountId) }
    if (messageId) { conditions.push('message_id = ?'); args.push(messageId) }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    args.push(limit, offset)

    const result = await this.client.execute({
      sql: `SELECT * FROM audit_log ${where} ORDER BY timestamp DESC LIMIT ? OFFSET ?`,
      args
    })

    return result.rows.map((row: any) => ({
      entry_id: row.entry_id,
      timestamp: row.timestamp,
      event: row.event,
      message_id: row.message_id,
      account_id: row.account_id,
      details: JSON.parse(row.details || '{}')
    }))
  }

  async countAuditLog(event?: string): Promise<number> {
    const result = event
      ? await this.client.execute({ sql: 'SELECT COUNT(*) as cnt FROM audit_log WHERE event = ?', args: [event] })
      : await this.client.execute('SELECT COUNT(*) as cnt FROM audit_log')
    return Number((result.rows[0] as any).cnt)
  }

  async close(): Promise<void> {
    if (this.client) {
      this.client.close()
      this.initialized = false
    }
  }
}

export const database = new Database()
export { database as db }

export type Provider = 'gmail' | 'outlook' | 'imap'

export interface Attachment {
  attachment_id: string
  filename: string
  mime_type: string
  size_bytes: number
  sha256: string
  local_path?: string
  ocr_text?: string
}

export interface NormalizedMessage {
  message_id: string
  account_id: string
  provider: Provider
  from_address: string
  from_name: string
  to: string[]
  cc: string[]
  subject: string
  body_text: string
  body_html: string
  date: string
  headers: Record<string, string>
  attachments: Attachment[]
  labels: string[]
  thread_id: string
  in_reply_to: string
}

export interface ProcessedMessage extends NormalizedMessage {
  processed_at: string
  tags: string[]
  matched_rules: string[]
  extracted_data: Record<string, unknown>
  routed_to: string[]
  is_read: boolean
  is_starred: boolean
  is_draft: boolean
}

// Compose / send types
export interface ComposeAttachment {
  filename: string
  mime_type: string
  content_base64: string
}

export interface ComposeMessage {
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  body_text: string
  body_html: string
  attachments: ComposeAttachment[]
  in_reply_to?: string
  thread_id?: string
  is_forward?: boolean
}

export interface FolderInfo {
  id: string
  name: string
  type: 'system' | 'user'
  unread_count: number
  total_count: number
}

export interface EmailAccount {
  account_id: string
  provider: Provider
  email_address: string
  display_name: string
  enabled: boolean
  sync_cursor: string | null
  polling_interval_ms: number
  folder_filters: string[]
  last_sync: string | null
}

export type RuleOperator = 'contains' | 'matches' | 'regex' | 'exists' | 'equals' | 'has_type'
export type RuleCombinator = 'all' | 'any' | 'none'

export interface RuleCondition {
  field: string
  op: RuleOperator
  value?: string
}

export interface RuleAction {
  type: 'tag' | 'route_to' | 'extract'
  value: string | string[]
}

export interface Rule {
  rule_id: string
  name: string
  priority: number
  enabled: boolean
  conditions: {
    combinator: RuleCombinator
    items: RuleCondition[]
  }
  actions: RuleAction[]
  use_llm: boolean
}

export interface AgentRegistration {
  agent_id: string
  name: string
  endpoint: string
  method: 'POST' | 'PUT'
  auth?: {
    type: 'bearer' | 'basic' | 'none'
    token_ref?: string
  }
  retry: {
    max_attempts: number
    backoff: 'exponential' | 'linear' | 'none'
  }
  timeout_seconds: number
  enabled: boolean
}

export interface AuditEntry {
  entry_id: string
  timestamp: string
  event: 'message_received' | 'rule_matched' | 'attachment_stored' | 'agent_notified' | 'message_sent' | 'error'
  message_id?: string
  account_id?: string
  details: Record<string, unknown>
}

export interface LLMProviderConfig {
  provider_id: string
  name: string
  type: 'ollama' | 'anthropic' | 'openai' | 'custom'
  endpoint: string
  model: string
  api_key_ref?: string
  max_tokens: number
  temperature: number
  enabled: boolean
}

// IPC channel types
export interface IpcChannels {
  // Accounts
  'accounts:list': () => EmailAccount[]
  'accounts:add': (account: Omit<EmailAccount, 'account_id'>) => EmailAccount
  'accounts:remove': (accountId: string) => void
  'accounts:sync': (accountId: string) => void
  'accounts:folders': (accountId: string) => FolderInfo[]

  // Messages — read
  'messages:list': (opts: { accountId?: string; folderId?: string; limit?: number; offset?: number }) => ProcessedMessage[]
  'messages:search': (query: string) => ProcessedMessage[]
  'messages:get': (messageId: string) => ProcessedMessage | null
  'messages:thread': (threadId: string) => ProcessedMessage[]

  // Messages — manage
  'messages:markRead': (messageIds: string[], read: boolean) => void
  'messages:star': (messageIds: string[], starred: boolean) => void
  'messages:archive': (messageIds: string[]) => void
  'messages:trash': (messageIds: string[]) => void
  'messages:move': (messageIds: string[], folderId: string) => void
  'messages:addLabels': (messageIds: string[], labels: string[]) => void
  'messages:removeLabels': (messageIds: string[], labels: string[]) => void

  // Compose — user-initiated only
  'compose:send': (accountId: string, message: ComposeMessage) => string
  'compose:saveDraft': (accountId: string, message: ComposeMessage) => string

  // Rules
  'rules:list': () => Rule[]
  'rules:upsert': (rule: Rule) => Rule
  'rules:delete': (ruleId: string) => void

  // Pipeline
  'pipeline:status': () => { running: boolean; lastRun: string | null; messagesProcessed: number }
  'pipeline:run': (accountId?: string) => { processed: number; errors: number }
}

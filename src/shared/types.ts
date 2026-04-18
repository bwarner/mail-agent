export type Provider = 'gmail' | 'outlook'

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
  event: 'message_received' | 'rule_matched' | 'attachment_stored' | 'agent_notified' | 'error'
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
  'accounts:list': () => EmailAccount[]
  'accounts:add': (account: Omit<EmailAccount, 'account_id'>) => EmailAccount
  'accounts:remove': (accountId: string) => void
  'accounts:sync': (accountId: string) => void
  'messages:list': (opts: { accountId?: string; limit?: number; offset?: number }) => ProcessedMessage[]
  'messages:search': (query: string) => ProcessedMessage[]
  'messages:get': (messageId: string) => ProcessedMessage | null
  'rules:list': () => Rule[]
  'rules:upsert': (rule: Rule) => Rule
  'rules:delete': (ruleId: string) => void
  'pipeline:status': () => { running: boolean; lastRun: string | null; messagesProcessed: number }
  'pipeline:run': (accountId?: string) => { processed: number; errors: number }
}

import type { NormalizedMessage, EmailAccount, ComposeMessage } from '../../shared/types'

export interface ConnectorResult {
  messages: NormalizedMessage[]
  newCursor: string | null
}

export interface FolderInfo {
  id: string
  name: string
  type: 'system' | 'user'
  unread_count: number
  total_count: number
}

export interface EmailConnector {
  readonly provider: EmailAccount['provider']

  // Read
  fetchMessages(account: EmailAccount): Promise<ConnectorResult>
  fetchThread(account: EmailAccount, threadId: string): Promise<NormalizedMessage[]>
  getFolders(account: EmailAccount): Promise<FolderInfo[]>
  testConnection(account: EmailAccount): Promise<boolean>

  // Send (user-initiated only — never called by pipeline/agents)
  sendMessage(account: EmailAccount, message: ComposeMessage): Promise<string>
  saveDraft(account: EmailAccount, message: ComposeMessage): Promise<string>

  // Manage
  markRead(account: EmailAccount, messageIds: string[], read: boolean): Promise<void>
  star(account: EmailAccount, messageIds: string[], starred: boolean): Promise<void>
  archive(account: EmailAccount, messageIds: string[]): Promise<void>
  trash(account: EmailAccount, messageIds: string[]): Promise<void>
  moveToFolder(account: EmailAccount, messageIds: string[], folderId: string): Promise<void>
  addLabels(account: EmailAccount, messageIds: string[], labels: string[]): Promise<void>
  removeLabels(account: EmailAccount, messageIds: string[], labels: string[]): Promise<void>
}

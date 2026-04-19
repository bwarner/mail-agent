import type { EmailConnector, ConnectorResult, FolderInfo } from './base'
import type { NormalizedMessage, EmailAccount, Attachment, ComposeMessage } from '../../shared/types'
import { sanitizeHtml } from '../sanitize'
import { createHash } from 'crypto'

interface GraphMessage {
  id: string
  subject: string
  from: { emailAddress: { name: string; address: string } }
  toRecipients: { emailAddress: { name: string; address: string } }[]
  ccRecipients: { emailAddress: { name: string; address: string } }[]
  body: { contentType: string; content: string }
  receivedDateTime: string
  internetMessageHeaders: { name: string; value: string }[]
  conversationId: string
  hasAttachments: boolean
  parentFolderId: string
  categories: string[]
  isRead: boolean
  flag: { flagStatus: string }
  isDraft: boolean
}

interface GraphAttachment {
  id: string
  name: string
  contentType: string
  size: number
  contentBytes?: string
}

interface GraphFolder {
  id: string
  displayName: string
  unreadItemCount: number
  totalItemCount: number
}

export class OutlookConnector implements EmailConnector {
  readonly provider = 'outlook' as const

  private async graphFetch(account: EmailAccount, path: string, opts?: RequestInit): Promise<any> {
    const token = (account as any)._access_token
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      ...opts,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...opts?.headers
      }
    })
    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status} ${response.statusText}`)
    }
    if (response.status === 204) return null
    return response.json()
  }

  // --- Read ---

  async fetchMessages(account: EmailAccount): Promise<ConnectorResult> {
    const messages: NormalizedMessage[] = []

    let path = `/me/mailFolders/inbox/messages?$top=50&$orderby=receivedDateTime desc`
    path += `&$expand=internetMessageHeaders`

    if (account.sync_cursor) {
      path += `&$filter=receivedDateTime gt ${account.sync_cursor}`
    }

    const response = await this.graphFetch(account, path)
    const graphMessages: GraphMessage[] = response.value ?? []

    for (const msg of graphMessages) {
      let attachments: Attachment[] = []
      if (msg.hasAttachments) {
        attachments = await this.fetchAttachments(account, msg.id)
      }
      messages.push(this.normalize(msg, account, attachments))
    }

    const newCursor = messages.length > 0
      ? new Date().toISOString()
      : account.sync_cursor

    return { messages, newCursor }
  }

  async fetchThread(account: EmailAccount, threadId: string): Promise<NormalizedMessage[]> {
    const conversationId = threadId.replace('outlook:', '')
    const response = await this.graphFetch(
      account,
      `/me/messages?$filter=conversationId eq '${conversationId}'&$orderby=receivedDateTime asc&$expand=internetMessageHeaders`
    )
    const graphMessages: GraphMessage[] = response.value ?? []
    const messages: NormalizedMessage[] = []

    for (const msg of graphMessages) {
      let attachments: Attachment[] = []
      if (msg.hasAttachments) {
        attachments = await this.fetchAttachments(account, msg.id)
      }
      messages.push(this.normalize(msg, account, attachments))
    }

    return messages
  }

  async getFolders(account: EmailAccount): Promise<FolderInfo[]> {
    const response = await this.graphFetch(account, `/me/mailFolders?$top=100`)
    const folders: GraphFolder[] = response.value ?? []

    return folders.map((f) => ({
      id: f.id,
      name: f.displayName,
      type: ['Inbox', 'Drafts', 'SentItems', 'DeletedItems', 'Junk'].includes(f.displayName)
        ? 'system' as const
        : 'user' as const,
      unread_count: f.unreadItemCount,
      total_count: f.totalItemCount
    }))
  }

  async testConnection(account: EmailAccount): Promise<boolean> {
    try {
      await this.graphFetch(account, '/me')
      return true
    } catch {
      return false
    }
  }

  // --- Send (user-initiated only) ---

  async sendMessage(account: EmailAccount, message: ComposeMessage): Promise<string> {
    const body = this.buildGraphMessage(message)

    const response = await this.graphFetch(account, '/me/sendMail', {
      method: 'POST',
      body: JSON.stringify({ message: body, saveToSentItems: true })
    })

    return `outlook:sent:${Date.now()}`
  }

  async saveDraft(account: EmailAccount, message: ComposeMessage): Promise<string> {
    const body = this.buildGraphMessage(message)

    const response = await this.graphFetch(account, '/me/messages', {
      method: 'POST',
      body: JSON.stringify(body)
    })

    return `outlook:${response.id}`
  }

  // --- Manage ---

  async markRead(account: EmailAccount, messageIds: string[], read: boolean): Promise<void> {
    for (const id of messageIds) {
      const rawId = id.replace('outlook:', '')
      await this.graphFetch(account, `/me/messages/${rawId}`, {
        method: 'PATCH',
        body: JSON.stringify({ isRead: read })
      })
    }
  }

  async star(account: EmailAccount, messageIds: string[], starred: boolean): Promise<void> {
    for (const id of messageIds) {
      const rawId = id.replace('outlook:', '')
      await this.graphFetch(account, `/me/messages/${rawId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          flag: { flagStatus: starred ? 'flagged' : 'notFlagged' }
        })
      })
    }
  }

  async archive(account: EmailAccount, messageIds: string[]): Promise<void> {
    const folders = await this.getFolders(account)
    const archive = folders.find((f) => f.name === 'Archive')
    if (!archive) return
    await this.moveToFolder(account, messageIds, archive.id)
  }

  async trash(account: EmailAccount, messageIds: string[]): Promise<void> {
    for (const id of messageIds) {
      const rawId = id.replace('outlook:', '')
      await this.graphFetch(account, `/me/messages/${rawId}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: 'deleteditems' })
      })
    }
  }

  async moveToFolder(account: EmailAccount, messageIds: string[], folderId: string): Promise<void> {
    for (const id of messageIds) {
      const rawId = id.replace('outlook:', '')
      await this.graphFetch(account, `/me/messages/${rawId}/move`, {
        method: 'POST',
        body: JSON.stringify({ destinationId: folderId })
      })
    }
  }

  async addLabels(account: EmailAccount, messageIds: string[], labels: string[]): Promise<void> {
    for (const id of messageIds) {
      const rawId = id.replace('outlook:', '')
      const msg = await this.graphFetch(account, `/me/messages/${rawId}?$select=categories`)
      const current: string[] = msg.categories ?? []
      const merged = [...new Set([...current, ...labels])]
      await this.graphFetch(account, `/me/messages/${rawId}`, {
        method: 'PATCH',
        body: JSON.stringify({ categories: merged })
      })
    }
  }

  async removeLabels(account: EmailAccount, messageIds: string[], labels: string[]): Promise<void> {
    for (const id of messageIds) {
      const rawId = id.replace('outlook:', '')
      const msg = await this.graphFetch(account, `/me/messages/${rawId}?$select=categories`)
      const current: string[] = msg.categories ?? []
      const filtered = current.filter((c) => !labels.includes(c))
      await this.graphFetch(account, `/me/messages/${rawId}`, {
        method: 'PATCH',
        body: JSON.stringify({ categories: filtered })
      })
    }
  }

  // --- Helpers ---

  private buildGraphMessage(message: ComposeMessage): Record<string, unknown> {
    const result: Record<string, unknown> = {
      subject: message.subject,
      body: {
        contentType: message.body_html ? 'html' : 'text',
        content: message.body_html || message.body_text
      },
      toRecipients: message.to.map((addr) => ({
        emailAddress: { address: addr }
      })),
      ccRecipients: message.cc.map((addr) => ({
        emailAddress: { address: addr }
      })),
      bccRecipients: message.bcc.map((addr) => ({
        emailAddress: { address: addr }
      }))
    }

    if (message.in_reply_to) {
      (result as any).internetMessageHeaders = [
        { name: 'In-Reply-To', value: message.in_reply_to }
      ]
    }

    if (message.attachments.length > 0) {
      result.attachments = message.attachments.map((att) => ({
        '@odata.type': '#microsoft.graph.fileAttachment',
        name: att.filename,
        contentType: att.mime_type,
        contentBytes: att.content_base64
      }))
    }

    return result
  }

  private async fetchAttachments(account: EmailAccount, messageId: string): Promise<Attachment[]> {
    const response = await this.graphFetch(account, `/me/messages/${messageId}/attachments`)
    const items: GraphAttachment[] = response.value ?? []

    return items.map((att) => ({
      attachment_id: `outlook:${messageId}:${att.id}`,
      filename: att.name.replace(/[/\\]/g, '_'),
      mime_type: att.contentType,
      size_bytes: att.size,
      sha256: att.contentBytes
        ? createHash('sha256').update(att.contentBytes, 'base64').digest('hex')
        : ''
    }))
  }

  private normalize(
    msg: GraphMessage,
    account: EmailAccount,
    attachments: Attachment[]
  ): NormalizedMessage {
    const headers: Record<string, string> = {}
    for (const h of msg.internetMessageHeaders ?? []) {
      headers[h.name.toLowerCase()] = h.value
    }

    const isHtml = msg.body.contentType === 'html'

    return {
      message_id: `outlook:${msg.id}`,
      account_id: account.account_id,
      provider: 'outlook',
      from_address: msg.from.emailAddress.address,
      from_name: msg.from.emailAddress.name,
      to: msg.toRecipients.map((r) => r.emailAddress.address),
      cc: msg.ccRecipients.map((r) => r.emailAddress.address),
      subject: msg.subject ?? '(no subject)',
      body_text: isHtml ? '' : msg.body.content,
      body_html: isHtml ? sanitizeHtml(msg.body.content) : '',
      date: new Date(msg.receivedDateTime).toISOString(),
      headers,
      attachments,
      labels: msg.categories ?? [],
      thread_id: `outlook:${msg.conversationId}`,
      in_reply_to: headers['in-reply-to'] ?? ''
    }
  }
}

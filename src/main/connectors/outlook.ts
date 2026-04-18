import type { EmailConnector, ConnectorResult } from './base'
import type { NormalizedMessage, EmailAccount, Attachment } from '../../shared/types'
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
}

interface GraphAttachment {
  id: string
  name: string
  contentType: string
  size: number
  contentBytes?: string
}

export class OutlookConnector implements EmailConnector {
  readonly provider = 'outlook' as const

  private async graphFetch(
    account: EmailAccount,
    path: string
  ): Promise<any> {
    const token = (account as any)._access_token
    const response = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!response.ok) {
      throw new Error(`Graph API error: ${response.status} ${response.statusText}`)
    }
    return response.json()
  }

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

  async testConnection(account: EmailAccount): Promise<boolean> {
    try {
      await this.graphFetch(account, '/me')
      return true
    } catch {
      return false
    }
  }

  private async fetchAttachments(
    account: EmailAccount,
    messageId: string
  ): Promise<Attachment[]> {
    const response = await this.graphFetch(
      account,
      `/me/messages/${messageId}/attachments`
    )
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

import { google, gmail_v1 } from 'googleapis'
import type { EmailConnector, ConnectorResult, FolderInfo } from './base'
import type { NormalizedMessage, EmailAccount, Attachment, ComposeMessage } from '../../shared/types'
import { sanitizeHtml } from '../sanitize'
import { createHash } from 'crypto'

export class GmailConnector implements EmailConnector {
  readonly provider = 'gmail' as const

  private getClient(account: EmailAccount): gmail_v1.Gmail {
    const auth = new google.auth.OAuth2()
    auth.setCredentials({
      access_token: (account as any)._access_token,
      refresh_token: (account as any)._refresh_token
    })
    return google.gmail({ version: 'v1', auth })
  }

  // --- Read ---

  async fetchMessages(account: EmailAccount): Promise<ConnectorResult> {
    const gmail = this.getClient(account)
    const messages: NormalizedMessage[] = []

    const listParams: gmail_v1.Params$Resource$Users$Messages$List = {
      userId: 'me',
      maxResults: 50,
      labelIds: account.folder_filters.length > 0 ? account.folder_filters : ['INBOX']
    }

    if (account.sync_cursor) {
      listParams.q = `after:${account.sync_cursor}`
    }

    const listResponse = await gmail.users.messages.list(listParams)
    const messageIds = listResponse.data.messages ?? []

    for (const stub of messageIds) {
      if (!stub.id) continue
      const full = await gmail.users.messages.get({
        userId: 'me',
        id: stub.id,
        format: 'full'
      })
      const normalized = this.parseMessage(full.data, account)
      if (normalized) messages.push(normalized)
    }

    const newCursor = messages.length > 0
      ? Math.floor(Date.now() / 1000).toString()
      : account.sync_cursor

    return { messages, newCursor }
  }

  async fetchThread(account: EmailAccount, threadId: string): Promise<NormalizedMessage[]> {
    const gmail = this.getClient(account)
    const rawId = threadId.replace('gmail:', '')

    const response = await gmail.users.threads.get({
      userId: 'me',
      id: rawId,
      format: 'full'
    })

    const messages: NormalizedMessage[] = []
    for (const msg of response.data.messages ?? []) {
      const normalized = this.parseMessage(msg, account)
      if (normalized) messages.push(normalized)
    }

    return messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }

  async getFolders(account: EmailAccount): Promise<FolderInfo[]> {
    const gmail = this.getClient(account)
    const response = await gmail.users.labels.list({ userId: 'me' })
    const folders: FolderInfo[] = []

    for (const label of response.data.labels ?? []) {
      if (!label.id || !label.name) continue
      const detail = await gmail.users.labels.get({ userId: 'me', id: label.id })
      folders.push({
        id: label.id,
        name: label.name,
        type: label.type === 'system' ? 'system' : 'user',
        unread_count: detail.data.messagesUnread ?? 0,
        total_count: detail.data.messagesTotal ?? 0
      })
    }

    return folders
  }

  async testConnection(account: EmailAccount): Promise<boolean> {
    try {
      const gmail = this.getClient(account)
      const response = await gmail.users.getProfile({ userId: 'me' })
      return response.status === 200
    } catch {
      return false
    }
  }

  // --- Send (user-initiated only) ---

  async sendMessage(account: EmailAccount, message: ComposeMessage): Promise<string> {
    const gmail = this.getClient(account)
    const raw = this.buildRawMessage(account, message)

    const response = await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw, threadId: message.thread_id?.replace('gmail:', '') }
    })

    return `gmail:${response.data.id}`
  }

  async saveDraft(account: EmailAccount, message: ComposeMessage): Promise<string> {
    const gmail = this.getClient(account)
    const raw = this.buildRawMessage(account, message)

    const response = await gmail.users.drafts.create({
      userId: 'me',
      requestBody: {
        message: { raw, threadId: message.thread_id?.replace('gmail:', '') }
      }
    })

    return `gmail:draft:${response.data.id}`
  }

  // --- Manage ---

  async markRead(account: EmailAccount, messageIds: string[], read: boolean): Promise<void> {
    const gmail = this.getClient(account)
    const ids = messageIds.map((id) => id.replace('gmail:', ''))

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids,
        ...(read
          ? { removeLabelIds: ['UNREAD'] }
          : { addLabelIds: ['UNREAD'] })
      }
    })
  }

  async star(account: EmailAccount, messageIds: string[], starred: boolean): Promise<void> {
    const gmail = this.getClient(account)
    const ids = messageIds.map((id) => id.replace('gmail:', ''))

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids,
        ...(starred
          ? { addLabelIds: ['STARRED'] }
          : { removeLabelIds: ['STARRED'] })
      }
    })
  }

  async archive(account: EmailAccount, messageIds: string[]): Promise<void> {
    const gmail = this.getClient(account)
    const ids = messageIds.map((id) => id.replace('gmail:', ''))

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: { ids, removeLabelIds: ['INBOX'] }
    })
  }

  async trash(account: EmailAccount, messageIds: string[]): Promise<void> {
    const gmail = this.getClient(account)
    for (const id of messageIds) {
      await gmail.users.messages.trash({
        userId: 'me',
        id: id.replace('gmail:', '')
      })
    }
  }

  async moveToFolder(account: EmailAccount, messageIds: string[], folderId: string): Promise<void> {
    const gmail = this.getClient(account)
    const ids = messageIds.map((id) => id.replace('gmail:', ''))

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: {
        ids,
        addLabelIds: [folderId],
        removeLabelIds: ['INBOX']
      }
    })
  }

  async addLabels(account: EmailAccount, messageIds: string[], labels: string[]): Promise<void> {
    const gmail = this.getClient(account)
    const ids = messageIds.map((id) => id.replace('gmail:', ''))

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: { ids, addLabelIds: labels }
    })
  }

  async removeLabels(account: EmailAccount, messageIds: string[], labels: string[]): Promise<void> {
    const gmail = this.getClient(account)
    const ids = messageIds.map((id) => id.replace('gmail:', ''))

    await gmail.users.messages.batchModify({
      userId: 'me',
      requestBody: { ids, removeLabelIds: labels }
    })
  }

  // --- Helpers ---

  private buildRawMessage(account: EmailAccount, message: ComposeMessage): string {
    const boundary = `boundary_${Date.now()}`
    const lines: string[] = []

    lines.push(`From: ${account.display_name} <${account.email_address}>`)
    lines.push(`To: ${message.to.join(', ')}`)
    if (message.cc.length > 0) lines.push(`Cc: ${message.cc.join(', ')}`)
    if (message.bcc.length > 0) lines.push(`Bcc: ${message.bcc.join(', ')}`)
    lines.push(`Subject: ${message.subject}`)
    if (message.in_reply_to) lines.push(`In-Reply-To: ${message.in_reply_to}`)
    lines.push(`MIME-Version: 1.0`)

    if (message.attachments.length > 0) {
      lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`)
      lines.push('')
      lines.push(`--${boundary}`)
      lines.push(`Content-Type: text/html; charset="UTF-8"`)
      lines.push('')
      lines.push(message.body_html || message.body_text)

      for (const att of message.attachments) {
        lines.push(`--${boundary}`)
        lines.push(`Content-Type: ${att.mime_type}; name="${att.filename}"`)
        lines.push(`Content-Disposition: attachment; filename="${att.filename}"`)
        lines.push(`Content-Transfer-Encoding: base64`)
        lines.push('')
        lines.push(att.content_base64)
      }
      lines.push(`--${boundary}--`)
    } else {
      lines.push(`Content-Type: text/html; charset="UTF-8"`)
      lines.push('')
      lines.push(message.body_html || message.body_text)
    }

    return Buffer.from(lines.join('\r\n')).toString('base64url')
  }

  private parseMessage(
    raw: gmail_v1.Schema$Message,
    account: EmailAccount
  ): NormalizedMessage | null {
    if (!raw.id || !raw.payload) return null

    const headers = this.extractHeaders(raw.payload.headers ?? [])
    const body = this.extractBody(raw.payload)
    const attachments = this.extractAttachments(raw.payload, raw.id)

    return {
      message_id: `gmail:${raw.id}`,
      account_id: account.account_id,
      provider: 'gmail',
      from_address: this.parseEmailAddress(headers['from'] ?? ''),
      from_name: this.parseDisplayName(headers['from'] ?? ''),
      to: this.parseRecipientList(headers['to'] ?? ''),
      cc: this.parseRecipientList(headers['cc'] ?? ''),
      subject: headers['subject'] ?? '(no subject)',
      body_text: body.text,
      body_html: sanitizeHtml(body.html),
      date: headers['date']
        ? new Date(headers['date']).toISOString()
        : new Date().toISOString(),
      headers,
      attachments,
      labels: raw.labelIds ?? [],
      thread_id: raw.threadId ? `gmail:${raw.threadId}` : '',
      in_reply_to: headers['in-reply-to'] ?? ''
    }
  }

  private extractHeaders(
    headers: gmail_v1.Schema$MessagePartHeader[]
  ): Record<string, string> {
    const result: Record<string, string> = {}
    for (const h of headers) {
      if (h.name && h.value) {
        result[h.name.toLowerCase()] = h.value
      }
    }
    return result
  }

  private extractBody(payload: gmail_v1.Schema$MessagePart): { text: string; html: string } {
    let text = ''
    let html = ''

    const walk = (part: gmail_v1.Schema$MessagePart) => {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        text += Buffer.from(part.body.data, 'base64url').toString('utf-8')
      } else if (part.mimeType === 'text/html' && part.body?.data) {
        html += Buffer.from(part.body.data, 'base64url').toString('utf-8')
      }
      if (part.parts) {
        for (const child of part.parts) walk(child)
      }
    }

    walk(payload)
    return { text, html }
  }

  private extractAttachments(
    payload: gmail_v1.Schema$MessagePart,
    messageId: string
  ): Attachment[] {
    const attachments: Attachment[] = []

    const walk = (part: gmail_v1.Schema$MessagePart) => {
      if (part.filename && part.filename.length > 0 && part.body) {
        const sanitizedFilename = part.filename.replace(/[/\\]/g, '_')
        attachments.push({
          attachment_id: `gmail:${messageId}:${part.partId ?? attachments.length}`,
          filename: sanitizedFilename,
          mime_type: part.mimeType ?? 'application/octet-stream',
          size_bytes: part.body.size ?? 0,
          sha256: part.body.attachmentId
            ? createHash('sha256').update(part.body.attachmentId).digest('hex')
            : ''
        })
      }
      if (part.parts) {
        for (const child of part.parts) walk(child)
      }
    }

    walk(payload)
    return attachments
  }

  private parseEmailAddress(from: string): string {
    const match = from.match(/<([^>]+)>/)
    return match ? match[1] : from.trim()
  }

  private parseDisplayName(from: string): string {
    const match = from.match(/^"?([^"<]*)"?\s*</)
    return match ? match[1].trim() : this.parseEmailAddress(from)
  }

  private parseRecipientList(value: string): string[] {
    if (!value) return []
    return value.split(',').map((r) => this.parseEmailAddress(r.trim())).filter(Boolean)
  }
}

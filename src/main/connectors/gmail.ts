import { google, gmail_v1 } from 'googleapis'
import type { EmailConnector, ConnectorResult } from './base'
import type { NormalizedMessage, EmailAccount, Attachment } from '../../shared/types'
import { sanitizeHtml } from '../sanitize'
import { createHash } from 'crypto'

export class GmailConnector implements EmailConnector {
  readonly provider = 'gmail' as const

  private getClient(account: EmailAccount): gmail_v1.Gmail {
    // OAuth2 client configured with stored credentials
    // In production, tokens come from Electron safeStorage
    const auth = new google.auth.OAuth2()
    auth.setCredentials({
      access_token: (account as any)._access_token,
      refresh_token: (account as any)._refresh_token
    })
    return google.gmail({ version: 'v1', auth })
  }

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

  async testConnection(account: EmailAccount): Promise<boolean> {
    try {
      const gmail = this.getClient(account)
      const response = await gmail.users.getProfile({ userId: 'me' })
      return response.status === 200
    } catch {
      return false
    }
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

  private extractBody(payload: gmail_v1.Schema$MessagePart): {
    text: string
    html: string
  } {
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

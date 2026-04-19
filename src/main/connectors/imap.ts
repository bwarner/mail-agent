import { ImapFlow } from 'imapflow'
import { createTransport } from 'nodemailer'
import { simpleParser } from 'mailparser'
import { createHash } from 'crypto'
import type { EmailConnector, ConnectorResult, FolderInfo } from './base'
import type { NormalizedMessage, EmailAccount, Attachment, ComposeMessage } from '../../shared/types'
import { sanitizeHtml } from '../sanitize'
import { vault } from '../auth/vault'

export interface ImapAccountConfig {
  imap_host: string
  imap_port: number
  smtp_host: string
  smtp_port: number
  username: string
  use_tls: boolean
}

async function getImapConfig(account: EmailAccount): Promise<ImapAccountConfig> {
  const config = await vault.loadJSON<ImapAccountConfig>(`imap_config:${account.account_id}`)
  if (!config) throw new Error(`No IMAP config found for ${account.account_id}`)
  return config
}

async function getPassword(account: EmailAccount): Promise<string> {
  const password = await vault.load(`imap_password:${account.account_id}`)
  if (!password) throw new Error(`No password found for ${account.account_id}`)
  return password
}

async function createImapClient(account: EmailAccount): Promise<ImapFlow> {
  const config = await getImapConfig(account)
  const password = await getPassword(account)

  return new ImapFlow({
    host: config.imap_host,
    port: config.imap_port,
    secure: config.use_tls,
    auth: {
      user: config.username,
      pass: password
    },
    logger: false
  })
}

export class ImapConnector implements EmailConnector {
  readonly provider = 'imap' as const

  async fetchMessages(account: EmailAccount): Promise<ConnectorResult> {
    const client = await createImapClient(account)
    const messages: NormalizedMessage[] = []

    try {
      await client.connect()

      const lock = await client.getMailboxLock('INBOX')
      try {
        const since = account.sync_cursor
          ? new Date(account.sync_cursor)
          : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

        const uids = await client.search({ since }, { uid: true })
        const fetchUids = uids.slice(-50)

        for await (const msg of client.fetch(fetchUids, {
          envelope: true,
          source: true,
          uid: true
        })) {
          try {
            const parsed = await simpleParser(msg.source)
            const normalized = this.parseMail(parsed, msg.uid, account)
            if (normalized) messages.push(normalized)
          } catch {}
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }

    const newCursor = messages.length > 0
      ? new Date().toISOString()
      : account.sync_cursor

    return { messages, newCursor }
  }

  async fetchThread(account: EmailAccount, threadId: string): Promise<NormalizedMessage[]> {
    const client = await createImapClient(account)
    const messages: NormalizedMessage[] = []

    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const messageId = threadId.replace('imap:', '')
        const uids = await client.search({
          header: { 'references': messageId }
        }, { uid: true })

        for await (const msg of client.fetch(uids, { source: true, uid: true })) {
          const parsed = await simpleParser(msg.source)
          const normalized = this.parseMail(parsed, msg.uid, account)
          if (normalized) messages.push(normalized)
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }

    return messages.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }

  async getFolders(account: EmailAccount): Promise<FolderInfo[]> {
    const client = await createImapClient(account)
    const folders: FolderInfo[] = []

    try {
      await client.connect()
      const mailboxes = await client.list()

      for (const mb of mailboxes) {
        const status = await client.status(mb.path, { messages: true, unseen: true })
        const isSystem = ['INBOX', 'Sent', 'Drafts', 'Trash', 'Junk', 'Spam'].some(
          (s) => mb.path.toLowerCase().includes(s.toLowerCase())
        )
        folders.push({
          id: mb.path,
          name: mb.name,
          type: isSystem ? 'system' : 'user',
          unread_count: status.unseen ?? 0,
          total_count: status.messages ?? 0
        })
      }
    } finally {
      await client.logout()
    }

    return folders
  }

  async testConnection(account: EmailAccount): Promise<boolean> {
    try {
      const client = await createImapClient(account)
      await client.connect()
      await client.logout()
      return true
    } catch {
      return false
    }
  }

  async sendMessage(account: EmailAccount, message: ComposeMessage): Promise<string> {
    const config = await getImapConfig(account)
    const password = await getPassword(account)

    const transport = createTransport({
      host: config.smtp_host,
      port: config.smtp_port,
      secure: config.smtp_port === 465,
      auth: {
        user: config.username,
        pass: password
      }
    })

    const mailOptions: any = {
      from: `${account.display_name} <${account.email_address}>`,
      to: message.to.join(', '),
      subject: message.subject,
      text: message.body_text,
      html: message.body_html || undefined
    }

    if (message.cc.length > 0) mailOptions.cc = message.cc.join(', ')
    if (message.bcc.length > 0) mailOptions.bcc = message.bcc.join(', ')
    if (message.in_reply_to) mailOptions.inReplyTo = message.in_reply_to

    if (message.attachments.length > 0) {
      mailOptions.attachments = message.attachments.map((att) => ({
        filename: att.filename,
        content: Buffer.from(att.content_base64, 'base64'),
        contentType: att.mime_type
      }))
    }

    const info = await transport.sendMail(mailOptions)
    return `imap:sent:${info.messageId}`
  }

  async saveDraft(_account: EmailAccount, _message: ComposeMessage): Promise<string> {
    return `imap:draft:${Date.now()}`
  }

  async markRead(account: EmailAccount, messageIds: string[], read: boolean): Promise<void> {
    const client = await createImapClient(account)
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uids = messageIds.map((id) => parseInt(id.replace('imap:', ''), 10)).filter((n) => !isNaN(n))
        if (read) {
          await client.messageFlagsAdd(uids, ['\\Seen'], { uid: true })
        } else {
          await client.messageFlagsRemove(uids, ['\\Seen'], { uid: true })
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }
  }

  async star(account: EmailAccount, messageIds: string[], starred: boolean): Promise<void> {
    const client = await createImapClient(account)
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uids = messageIds.map((id) => parseInt(id.replace('imap:', ''), 10)).filter((n) => !isNaN(n))
        if (starred) {
          await client.messageFlagsAdd(uids, ['\\Flagged'], { uid: true })
        } else {
          await client.messageFlagsRemove(uids, ['\\Flagged'], { uid: true })
        }
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }
  }

  async archive(account: EmailAccount, messageIds: string[]): Promise<void> {
    await this.moveToFolder(account, messageIds, 'Archive')
  }

  async trash(account: EmailAccount, messageIds: string[]): Promise<void> {
    await this.moveToFolder(account, messageIds, 'Trash')
  }

  async moveToFolder(account: EmailAccount, messageIds: string[], folderId: string): Promise<void> {
    const client = await createImapClient(account)
    try {
      await client.connect()
      const lock = await client.getMailboxLock('INBOX')
      try {
        const uids = messageIds.map((id) => parseInt(id.replace('imap:', ''), 10)).filter((n) => !isNaN(n))
        await client.messageMove(uids, folderId, { uid: true })
      } finally {
        lock.release()
      }
    } finally {
      await client.logout()
    }
  }

  async addLabels(): Promise<void> {}
  async removeLabels(): Promise<void> {}

  private parseMail(parsed: any, uid: number, account: EmailAccount): NormalizedMessage | null {
    const messageId = parsed.messageId ?? `imap:${account.account_id}:${uid}`

    const headers: Record<string, string> = {}
    if (parsed.headers) {
      for (const [key, value] of parsed.headers) {
        headers[key.toLowerCase()] = typeof value === 'string' ? value : String(value)
      }
    }

    const attachments: Attachment[] = (parsed.attachments ?? []).map((att: any, idx: number) => ({
      attachment_id: `imap:${uid}:${idx}`,
      filename: (att.filename ?? 'attachment').replace(/[/\\]/g, '_'),
      mime_type: att.contentType ?? 'application/octet-stream',
      size_bytes: att.size ?? 0,
      sha256: att.content
        ? createHash('sha256').update(att.content).digest('hex')
        : ''
    }))

    return {
      message_id: `imap:${uid}`,
      account_id: account.account_id,
      provider: 'imap',
      from_address: parsed.from?.value?.[0]?.address ?? '',
      from_name: parsed.from?.value?.[0]?.name ?? '',
      to: (parsed.to?.value ?? []).map((r: any) => r.address),
      cc: (parsed.cc?.value ?? []).map((r: any) => r.address),
      subject: parsed.subject ?? '(no subject)',
      body_text: parsed.text ?? '',
      body_html: sanitizeHtml(parsed.html ?? ''),
      date: parsed.date?.toISOString() ?? new Date().toISOString(),
      headers,
      attachments,
      labels: [],
      thread_id: parsed.references?.[0] ? `imap:${parsed.references[0]}` : `imap:${messageId}`,
      in_reply_to: parsed.inReplyTo ?? ''
    }
  }
}

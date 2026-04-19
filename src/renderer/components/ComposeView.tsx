import React, { useState } from 'react'
import type { ProcessedMessage, ComposeMessage, EmailAccount } from '../../shared/types'

export type ComposeMode = 'new' | 'reply' | 'reply-all' | 'forward'

interface ComposeViewProps {
  mode: ComposeMode
  replyTo?: ProcessedMessage
  accounts: EmailAccount[]
  defaultAccountId?: string
  onSend: () => void
  onDiscard: () => void
}

function buildInitialState(
  mode: ComposeMode,
  replyTo: ProcessedMessage | undefined,
  accounts: EmailAccount[]
): { to: string; cc: string; bcc: string; subject: string; body: string; accountId: string } {
  const accountId = replyTo?.account_id ?? accounts[0]?.account_id ?? ''
  const account = accounts.find((a) => a.account_id === accountId)

  if (!replyTo) {
    return { to: '', cc: '', bcc: '', subject: '', body: '', accountId }
  }

  const replyPrefix = replyTo.subject.startsWith('Re:') ? '' : 'Re: '
  const fwdPrefix = replyTo.subject.startsWith('Fwd:') ? '' : 'Fwd: '
  const quotedBody = `\n\n--- Original Message ---\nFrom: ${replyTo.from_name} <${replyTo.from_address}>\nDate: ${new Date(replyTo.date).toLocaleString()}\nSubject: ${replyTo.subject}\n\n${replyTo.body_text}`

  switch (mode) {
    case 'reply':
      return {
        to: replyTo.from_address,
        cc: '',
        bcc: '',
        subject: `${replyPrefix}${replyTo.subject}`,
        body: quotedBody,
        accountId
      }
    case 'reply-all': {
      const myAddress = account?.email_address ?? ''
      const allTo = [replyTo.from_address, ...replyTo.to]
        .filter((addr) => addr !== myAddress)
      const allCc = replyTo.cc.filter((addr) => addr !== myAddress)
      return {
        to: allTo.join(', '),
        cc: allCc.join(', '),
        bcc: '',
        subject: `${replyPrefix}${replyTo.subject}`,
        body: quotedBody,
        accountId
      }
    }
    case 'forward':
      return {
        to: '',
        cc: '',
        bcc: '',
        subject: `${fwdPrefix}${replyTo.subject}`,
        body: quotedBody,
        accountId
      }
    default:
      return { to: '', cc: '', bcc: '', subject: '', body: '', accountId }
  }
}

export function ComposeView({
  mode,
  replyTo,
  accounts,
  onSend,
  onDiscard
}: ComposeViewProps) {
  const initial = buildInitialState(mode, replyTo, accounts)

  const [to, setTo] = useState(initial.to)
  const [cc, setCc] = useState(initial.cc)
  const [bcc, setBcc] = useState(initial.bcc)
  const [subject, setSubject] = useState(initial.subject)
  const [body, setBody] = useState(initial.body)
  const [accountId, setAccountId] = useState(initial.accountId)
  const [sending, setSending] = useState(false)
  const [showCcBcc, setShowCcBcc] = useState(!!initial.cc || !!initial.bcc)

  const handleSend = async () => {
    if (!to.trim() || !accountId) return
    setSending(true)

    const message: ComposeMessage = {
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      cc: cc.split(',').map((s) => s.trim()).filter(Boolean),
      bcc: bcc.split(',').map((s) => s.trim()).filter(Boolean),
      subject,
      body_text: body,
      body_html: '',
      attachments: [],
      in_reply_to: (mode === 'reply' || mode === 'reply-all') ? replyTo?.message_id : undefined,
      thread_id: (mode !== 'forward' && mode !== 'new') ? replyTo?.thread_id : undefined,
      is_forward: mode === 'forward'
    }

    try {
      await window.mailAgent.compose.send(accountId, message)
      onSend()
    } catch (err) {
      console.error('Send failed:', err)
    } finally {
      setSending(false)
    }
  }

  const handleSaveDraft = async () => {
    if (!accountId) return
    const message: ComposeMessage = {
      to: to.split(',').map((s) => s.trim()).filter(Boolean),
      cc: cc.split(',').map((s) => s.trim()).filter(Boolean),
      bcc: bcc.split(',').map((s) => s.trim()).filter(Boolean),
      subject,
      body_text: body,
      body_html: '',
      attachments: [],
      in_reply_to: replyTo?.message_id,
      thread_id: replyTo?.thread_id
    }
    await window.mailAgent.compose.saveDraft(accountId, message)
  }

  const modeLabel = {
    new: 'New Message',
    reply: 'Reply',
    'reply-all': 'Reply All',
    forward: 'Forward'
  }[mode]

  return (
    <div className="compose-view">
      <div className="compose-header">
        <h3>{modeLabel}</h3>
        <div className="compose-header-actions">
          <button className="btn btn-secondary" onClick={handleSaveDraft}>
            Save Draft
          </button>
          <button className="btn btn-secondary" onClick={onDiscard}>
            Discard
          </button>
        </div>
      </div>

      <div className="compose-fields">
        {accounts.length > 1 && (
          <div className="compose-field">
            <label>From</label>
            <select
              value={accountId}
              onChange={(e) => setAccountId(e.target.value)}
              className="compose-select"
            >
              {accounts.map((a) => (
                <option key={a.account_id} value={a.account_id}>
                  {a.display_name} &lt;{a.email_address}&gt;
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="compose-field">
          <label>To</label>
          <input
            className="compose-input"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="recipient@example.com"
          />
          {!showCcBcc && (
            <button className="compose-toggle" onClick={() => setShowCcBcc(true)}>
              Cc/Bcc
            </button>
          )}
        </div>

        {showCcBcc && (
          <>
            <div className="compose-field">
              <label>Cc</label>
              <input
                className="compose-input"
                value={cc}
                onChange={(e) => setCc(e.target.value)}
              />
            </div>
            <div className="compose-field">
              <label>Bcc</label>
              <input
                className="compose-input"
                value={bcc}
                onChange={(e) => setBcc(e.target.value)}
              />
            </div>
          </>
        )}

        <div className="compose-field">
          <label>Subject</label>
          <input
            className="compose-input"
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
          />
        </div>
      </div>

      <textarea
        className="compose-body"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        placeholder="Write your message..."
      />

      <div className="compose-footer">
        <button
          className="btn btn-primary"
          onClick={handleSend}
          disabled={sending || !to.trim()}
        >
          {sending ? 'Sending...' : 'Send'}
        </button>
      </div>
    </div>
  )
}

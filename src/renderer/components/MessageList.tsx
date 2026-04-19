import React, { useState } from 'react'
import type { ProcessedMessage } from '../../shared/types'

interface MessageListProps {
  messages: ProcessedMessage[]
  selectedId: string | null
  onSelect: (message: ProcessedMessage) => void
  onRefresh: () => void
}

function formatDate(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  if (isToday) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  const diffDays = Math.floor((now.getTime() - date.getTime()) / (1000 * 60 * 60 * 24))
  if (diffDays < 7) {
    return date.toLocaleDateString([], { weekday: 'short' })
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max) + '...'
}

export function MessageList({ messages, selectedId, onSelect, onRefresh }: MessageListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.stopPropagation()
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleMarkRead = async (read: boolean) => {
    const ids = [...selected]
    if (ids.length === 0) return
    await window.mailAgent.messages.markRead(ids, read)
    setSelected(new Set())
    onRefresh()
  }

  const handleStar = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    await window.mailAgent.messages.star(ids, true)
    setSelected(new Set())
    onRefresh()
  }

  const handleArchive = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    await window.mailAgent.messages.archive(ids)
    setSelected(new Set())
    onRefresh()
  }

  const handleTrash = async () => {
    const ids = [...selected]
    if (ids.length === 0) return
    await window.mailAgent.messages.trash(ids)
    setSelected(new Set())
    onRefresh()
  }

  if (messages.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">~</div>
        <div>No messages</div>
        <div>Sync an account to pull in emails</div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {selected.size > 0 && (
        <div className="message-actions-bar">
          <span>{selected.size} selected</span>
          <button className="btn-action" onClick={() => handleMarkRead(true)}>Read</button>
          <button className="btn-action" onClick={() => handleMarkRead(false)}>Unread</button>
          <button className="btn-action" onClick={handleStar}>Star</button>
          <button className="btn-action" onClick={handleArchive}>Archive</button>
          <button className="btn-action" onClick={handleTrash}>Trash</button>
          <button className="btn-action" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      <div className="message-list">
        {messages.map((msg) => (
          <div
            key={msg.message_id}
            className={[
              'message-row',
              msg.message_id === selectedId ? 'selected' : '',
              selected.has(msg.message_id) ? 'checked' : '',
              msg.is_read === false ? 'unread' : ''
            ].filter(Boolean).join(' ')}
            onClick={(e) => {
              if (e.ctrlKey || e.metaKey) {
                toggleSelect(msg.message_id, e)
              } else {
                onSelect(msg)
              }
            }}
          >
            <div className="message-indicators">
              {msg.is_starred && <span className="star-indicator">*</span>}
              {msg.attachments.length > 0 && <span className="attach-indicator">@</span>}
            </div>
            <div className="message-sender">
              {msg.from_name || msg.from_address}
            </div>
            <div className="message-content">
              <div className="message-subject">{msg.subject}</div>
              <div className="message-preview">
                {truncate(msg.body_text, 120)}
              </div>
            </div>
            <div className="message-meta">
              <span className="message-date">{formatDate(msg.date)}</span>
              <div className="message-tags">
                {msg.tags.map((tag) => (
                  <span key={tag} className="tag">{tag}</span>
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

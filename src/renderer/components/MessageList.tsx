import React from 'react'
import type { ProcessedMessage } from '../../shared/types'

interface MessageListProps {
  messages: ProcessedMessage[]
  selectedId: string | null
  onSelect: (message: ProcessedMessage) => void
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

export function MessageList({ messages, selectedId, onSelect }: MessageListProps) {
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
    <div className="message-list">
      {messages.map((msg) => (
        <div
          key={msg.message_id}
          className={`message-row ${msg.message_id === selectedId ? 'selected' : ''}`}
          onClick={() => onSelect(msg)}
        >
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
  )
}

import React, { useState, useEffect } from 'react'
import type { ProcessedMessage } from '../../shared/types'

interface ThreadViewProps {
  threadId: string
  onReply: (message: ProcessedMessage) => void
  onReplyAll: (message: ProcessedMessage) => void
  onForward: (message: ProcessedMessage) => void
}

export function ThreadView({ threadId, onReply, onReplyAll, onForward }: ThreadViewProps) {
  const [messages, setMessages] = useState<ProcessedMessage[]>([])
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.mailAgent.messages
      .thread(threadId)
      .then((msgs) => {
        setMessages(msgs)
        if (msgs.length > 0) {
          setExpandedIds(new Set([msgs[msgs.length - 1].message_id]))
        }
      })
      .finally(() => setLoading(false))
  }, [threadId])

  const toggleExpand = (id: string) => {
    setExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (loading) {
    return <div className="empty-state">Loading thread...</div>
  }

  if (messages.length === 0) {
    return <div className="empty-state">No messages in thread</div>
  }

  const subject = messages[0].subject

  return (
    <div className="thread-view">
      <div className="thread-header">
        <h2>{subject}</h2>
        <span className="thread-count">{messages.length} messages</span>
      </div>

      <div className="thread-messages">
        {messages.map((msg) => {
          const expanded = expandedIds.has(msg.message_id)
          return (
            <div key={msg.message_id} className="thread-message">
              <div
                className="thread-message-header"
                onClick={() => toggleExpand(msg.message_id)}
              >
                <div className="thread-message-sender">
                  <strong>{msg.from_name || msg.from_address}</strong>
                  {!expanded && (
                    <span className="thread-message-snippet">
                      {' '}&mdash; {msg.body_text.slice(0, 80)}
                    </span>
                  )}
                </div>
                <span className="message-date">
                  {new Date(msg.date).toLocaleString()}
                </span>
              </div>

              {expanded && (
                <div className="thread-message-body">
                  <div className="thread-message-meta">
                    <div>To: {msg.to.join(', ')}</div>
                    {msg.cc.length > 0 && <div>Cc: {msg.cc.join(', ')}</div>}
                    {msg.attachments.length > 0 && (
                      <div>
                        Attachments: {msg.attachments.map((a) => a.filename).join(', ')}
                      </div>
                    )}
                    {msg.tags.length > 0 && (
                      <div className="message-tags" style={{ marginTop: '4px' }}>
                        {msg.tags.map((tag) => (
                          <span key={tag} className="tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="thread-message-content">
                    {msg.body_html ? (
                      <div
                        dangerouslySetInnerHTML={{ __html: msg.body_html }}
                        className="html-content"
                      />
                    ) : (
                      <pre className="text-content">{msg.body_text}</pre>
                    )}
                  </div>

                  <div className="thread-message-actions">
                    <button className="btn btn-secondary" onClick={() => onReply(msg)}>
                      Reply
                    </button>
                    <button className="btn btn-secondary" onClick={() => onReplyAll(msg)}>
                      Reply All
                    </button>
                    <button className="btn btn-secondary" onClick={() => onForward(msg)}>
                      Forward
                    </button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

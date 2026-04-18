import React from 'react'
import type { ProcessedMessage } from '../../shared/types'

interface MessageDetailProps {
  message: ProcessedMessage | null
}

export function MessageDetail({ message }: MessageDetailProps) {
  if (!message) {
    return (
      <div className="empty-state">
        <div>Select a message to view</div>
      </div>
    )
  }

  return (
    <div className="message-detail">
      <h2>{message.subject}</h2>

      <div className="message-detail-meta">
        <div>
          <strong>From:</strong> {message.from_name} &lt;{message.from_address}&gt;
        </div>
        <div>
          <strong>To:</strong> {message.to.join(', ')}
        </div>
        {message.cc.length > 0 && (
          <div>
            <strong>Cc:</strong> {message.cc.join(', ')}
          </div>
        )}
        <div>
          <strong>Date:</strong> {new Date(message.date).toLocaleString()}
        </div>
        <div>
          <strong>Account:</strong> {message.account_id} ({message.provider})
        </div>
        {message.tags.length > 0 && (
          <div>
            <strong>Tags:</strong>{' '}
            <span className="message-tags" style={{ display: 'inline-flex' }}>
              {message.tags.map((tag) => (
                <span key={tag} className="tag">{tag}</span>
              ))}
            </span>
          </div>
        )}
        {message.matched_rules.length > 0 && (
          <div>
            <strong>Matched rules:</strong> {message.matched_rules.join(', ')}
          </div>
        )}
        {message.attachments.length > 0 && (
          <div>
            <strong>Attachments:</strong>{' '}
            {message.attachments.map((a) => a.filename).join(', ')}
          </div>
        )}
        {Object.keys(message.extracted_data).length > 0 && (
          <div>
            <strong>Extracted:</strong>{' '}
            {JSON.stringify(message.extracted_data)}
          </div>
        )}
      </div>

      <div className="message-detail-body">
        {message.body_text || '(no text content)'}
      </div>
    </div>
  )
}

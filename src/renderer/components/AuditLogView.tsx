import React, { useState, useEffect, useCallback } from 'react'

interface AuditEntry {
  entry_id: string
  timestamp: string
  event: string
  message_id?: string
  account_id?: string
  details: Record<string, unknown>
}

const EVENT_LABELS: Record<string, string> = {
  message_received: 'Received',
  rule_matched: 'Rule Matched',
  attachment_stored: 'Attachment',
  agent_notified: 'Agent',
  message_sent: 'Sent',
  error: 'Error'
}

const EVENT_COLORS: Record<string, string> = {
  message_received: 'var(--success)',
  rule_matched: 'var(--warning)',
  message_sent: '#60a5fa',
  error: 'var(--accent)',
  agent_notified: '#a78bfa',
  attachment_stored: '#34d399'
}

export function AuditLogView() {
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [selected, setSelected] = useState<AuditEntry | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string>('')
  const [page, setPage] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const PAGE_SIZE = 50

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const opts: any = { limit: PAGE_SIZE, offset: page * PAGE_SIZE }
      if (filter) opts.event = filter
      const result = await window.mailAgent.audit.list(opts)
      setEntries(Array.isArray(result) ? result : [])
      const count = await window.mailAgent.audit.count(filter || undefined)
      setTotalCount(count)
    } finally {
      setLoading(false)
    }
  }, [page, filter])

  useEffect(() => { refresh() }, [refresh])

  const formatTime = (ts: string) => {
    const d = new Date(ts)
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' }) +
      ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  }

  const totalPages = Math.ceil(totalCount / PAGE_SIZE)

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div className="audit-list-panel">
        <div className="audit-toolbar">
          <select
            className="compose-select"
            value={filter}
            onChange={(e) => { setFilter(e.target.value); setPage(0) }}
            style={{ flex: 1 }}
          >
            <option value="">All events</option>
            <option value="message_received">Received</option>
            <option value="rule_matched">Rule Matched</option>
            <option value="message_sent">Sent</option>
            <option value="agent_notified">Agent</option>
            <option value="attachment_stored">Attachment</option>
            <option value="error">Error</option>
          </select>
          <span className="audit-count">{totalCount} entries</span>
        </div>

        {loading && entries.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px' }}>Loading...</div>
        ) : entries.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px' }}>
            <div>No audit entries</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>
              Events appear here as emails are processed
            </div>
          </div>
        ) : (
          <>
            <div className="audit-entries">
              {entries.map((entry) => (
                <div
                  key={entry.entry_id}
                  className={`audit-entry ${selected?.entry_id === entry.entry_id ? 'selected' : ''}`}
                  onClick={() => setSelected(entry)}
                >
                  <span
                    className="audit-event-badge"
                    style={{ background: EVENT_COLORS[entry.event] ?? 'var(--tag-bg)' }}
                  >
                    {EVENT_LABELS[entry.event] ?? entry.event}
                  </span>
                  <span className="audit-summary">
                    {summarize(entry)}
                  </span>
                  <span className="audit-time">{formatTime(entry.timestamp)}</span>
                </div>
              ))}
            </div>
            {totalPages > 1 && (
              <div className="audit-pagination">
                <button className="btn-action" disabled={page === 0} onClick={() => setPage(page - 1)}>Prev</button>
                <span>{page + 1} / {totalPages}</span>
                <button className="btn-action" disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>Next</button>
              </div>
            )}
          </>
        )}
      </div>

      <div className="audit-detail-panel">
        {selected ? (
          <div className="audit-detail">
            <h3 style={{ marginBottom: '16px' }}>
              <span
                className="audit-event-badge"
                style={{ background: EVENT_COLORS[selected.event] ?? 'var(--tag-bg)', marginRight: '8px' }}
              >
                {EVENT_LABELS[selected.event] ?? selected.event}
              </span>
              {formatTime(selected.timestamp)}
            </h3>

            <div className="settings-list">
              <div className="settings-list-item">
                <div>
                  <div className="settings-item-title">Entry ID</div>
                  <div className="settings-item-sub">{selected.entry_id}</div>
                </div>
              </div>
              {selected.message_id && (
                <div className="settings-list-item">
                  <div>
                    <div className="settings-item-title">Message ID</div>
                    <div className="settings-item-sub">{selected.message_id}</div>
                  </div>
                </div>
              )}
              {selected.account_id && (
                <div className="settings-list-item">
                  <div>
                    <div className="settings-item-title">Account</div>
                    <div className="settings-item-sub">{selected.account_id}</div>
                  </div>
                </div>
              )}
            </div>

            <h4 style={{ marginTop: '20px', marginBottom: '8px', fontSize: '13px', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>
              Details
            </h4>
            <pre className="audit-detail-json">
              {JSON.stringify(selected.details, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="empty-state">Select an entry to view details</div>
        )}
      </div>
    </div>
  )
}

function summarize(entry: AuditEntry): string {
  const d = entry.details
  switch (entry.event) {
    case 'message_received':
      return `${d.from ?? ''} — ${d.subject ?? ''}`
    case 'rule_matched':
      return `Rule: ${d.rule ?? ''}`
    case 'message_sent':
      return `To: ${Array.isArray(d.to) ? d.to.join(', ') : d.to ?? ''}`
    case 'agent_notified':
      return `Agent: ${d.agent ?? ''}`
    case 'error':
      return String(d.error ?? 'Unknown error').slice(0, 80)
    default:
      return JSON.stringify(d).slice(0, 60)
  }
}

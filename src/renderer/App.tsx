import React, { useState, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { MessageList } from './components/MessageList'
import { MessageDetail } from './components/MessageDetail'
import { useMessages } from './hooks/useMessages'
import { useAccounts } from './hooks/useAccounts'
import type { ProcessedMessage } from '../shared/types'

export function App() {
  const [activeView, setActiveView] = useState('inbox')
  const [selectedMessage, setSelectedMessage] = useState<ProcessedMessage | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [syncing, setSyncing] = useState(false)

  const { accounts } = useAccounts()
  const { messages, loading, refresh, search } = useMessages()

  const handleSync = useCallback(async () => {
    setSyncing(true)
    try {
      await window.mailAgent.pipeline.run()
      await refresh()
    } finally {
      setSyncing(false)
    }
  }, [refresh])

  const handleSearch = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault()
      search(searchQuery)
    },
    [searchQuery, search]
  )

  return (
    <div className="app-layout">
      <Sidebar
        accounts={accounts}
        activeView={activeView}
        onViewChange={setActiveView}
      />

      <div className="main-content">
        <div className="toolbar">
          <form onSubmit={handleSearch} style={{ flex: 1, display: 'flex', gap: '8px' }}>
            <input
              className="search-input"
              type="text"
              placeholder="Search messages..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </form>
          <button
            className="btn btn-primary"
            onClick={handleSync}
            disabled={syncing}
          >
            {syncing ? 'Syncing...' : 'Sync'}
          </button>
          <button className="btn btn-secondary" onClick={refresh}>
            Refresh
          </button>
        </div>

        {activeView === 'inbox' && (
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ width: '45%', borderRight: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <MessageList
                messages={messages}
                selectedId={selectedMessage?.message_id ?? null}
                onSelect={setSelectedMessage}
              />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <MessageDetail message={selectedMessage} />
            </div>
          </div>
        )}

        {activeView !== 'inbox' && (
          <div className="empty-state">
            <div>{activeView.charAt(0).toUpperCase() + activeView.slice(1)}</div>
            <div>Coming in a future phase</div>
          </div>
        )}

        <div className="status-bar">
          <span>
            {loading ? 'Loading...' : `${messages.length} messages`}
          </span>
          <span>{accounts.length} account(s) connected</span>
        </div>
      </div>
    </div>
  )
}

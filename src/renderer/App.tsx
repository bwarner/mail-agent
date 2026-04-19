import React, { useState, useCallback } from 'react'
import { Sidebar } from './components/Sidebar'
import { MessageList } from './components/MessageList'
import { ThreadView } from './components/ThreadView'
import { ComposeView, ComposeMode } from './components/ComposeView'
import { PluginsView } from './components/PluginsView'
import { AddAccountDialog } from './components/AddAccountDialog'
import { SettingsView } from './components/SettingsView'
import { RulesView } from './components/RulesView'
import { AuditLogView } from './components/AuditLogView'
import { useMessages } from './hooks/useMessages'
import { useAccounts } from './hooks/useAccounts'
import type { ProcessedMessage } from '../shared/types'

type RightPanel =
  | { type: 'thread'; threadId: string }
  | { type: 'compose'; mode: ComposeMode; replyTo?: ProcessedMessage }
  | { type: 'none' }

export function App() {
  const [activeView, setActiveView] = useState('inbox')
  const [selectedMessage, setSelectedMessage] = useState<ProcessedMessage | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>({ type: 'none' })
  const [searchQuery, setSearchQuery] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [showAddAccount, setShowAddAccount] = useState(false)
  const [searchMode, setSearchMode] = useState<'text' | 'semantic'>('text')
  const [selectedFolder, setSelectedFolder] = useState<{ accountId: string; folderId: string } | null>(null)

  const { accounts, refresh: refreshAccounts } = useAccounts()
  const { messages, loading, refresh, search } = useMessages(selectedFolder?.accountId)

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
      if (!searchQuery.trim()) {
        refresh()
        return
      }
      search(searchQuery, searchMode)
    },
    [searchQuery, search, searchMode, refresh]
  )

  const handleSelectMessage = useCallback((msg: ProcessedMessage) => {
    setSelectedMessage(msg)
    if (msg.thread_id) {
      setRightPanel({ type: 'thread', threadId: msg.thread_id })
    }
    if (!msg.is_read) {
      window.mailAgent.messages.markRead([msg.message_id], true)
    }
  }, [])

  const handleCompose = useCallback(() => {
    setRightPanel({ type: 'compose', mode: 'new' })
  }, [])

  const handleReply = useCallback((msg: ProcessedMessage) => {
    setRightPanel({ type: 'compose', mode: 'reply', replyTo: msg })
  }, [])

  const handleReplyAll = useCallback((msg: ProcessedMessage) => {
    setRightPanel({ type: 'compose', mode: 'reply-all', replyTo: msg })
  }, [])

  const handleForward = useCallback((msg: ProcessedMessage) => {
    setRightPanel({ type: 'compose', mode: 'forward', replyTo: msg })
  }, [])

  const handleComposeDone = useCallback(() => {
    setRightPanel(
      selectedMessage?.thread_id
        ? { type: 'thread', threadId: selectedMessage.thread_id }
        : { type: 'none' }
    )
    refresh()
  }, [selectedMessage, refresh])

  const handleFolderSelect = useCallback((accountId: string, folderId: string) => {
    setSelectedFolder({ accountId, folderId })
    setActiveView('inbox')
  }, [])

  return (
    <div className="app-layout">
      <Sidebar
        accounts={accounts}
        activeView={activeView}
        onViewChange={setActiveView}
        onCompose={handleCompose}
        onFolderSelect={handleFolderSelect}
        onAddAccount={() => setShowAddAccount(true)}
      />

      <div className="main-content">
        <div className="toolbar">
          <form onSubmit={handleSearch} style={{ flex: 1, display: 'flex', gap: '8px', alignItems: 'center' }}>
            <input
              className="search-input"
              type="text"
              placeholder={searchMode === 'semantic' ? 'Semantic search...' : 'Search messages...'}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            <button
              type="button"
              className={`btn-action ${searchMode === 'semantic' ? 'active-toggle' : ''}`}
              onClick={() => setSearchMode(searchMode === 'text' ? 'semantic' : 'text')}
              title={searchMode === 'semantic' ? 'Semantic search (AI)' : 'Text search'}
            >
              {searchMode === 'semantic' ? 'AI' : 'Aa'}
            </button>
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
            <div style={{ width: '40%', borderRight: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              <MessageList
                messages={messages}
                selectedId={selectedMessage?.message_id ?? null}
                onSelect={handleSelectMessage}
                onRefresh={refresh}
              />
            </div>
            <div style={{ flex: 1, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
              {rightPanel.type === 'thread' && (
                <ThreadView
                  threadId={rightPanel.threadId}
                  onReply={handleReply}
                  onReplyAll={handleReplyAll}
                  onForward={handleForward}
                />
              )}
              {rightPanel.type === 'compose' && (
                <ComposeView
                  mode={rightPanel.mode}
                  replyTo={rightPanel.replyTo}
                  accounts={accounts}
                  onSend={handleComposeDone}
                  onDiscard={handleComposeDone}
                />
              )}
              {rightPanel.type === 'none' && (
                <div className="empty-state">
                  <div>Select a message or compose a new one</div>
                </div>
              )}
            </div>
          </div>
        )}

        {activeView === 'rules' && <RulesView />}

        {activeView === 'plugins' && <PluginsView />}

        {activeView === 'audit' && <AuditLogView />}

        {activeView === 'settings' && <SettingsView />}

        <div className="status-bar">
          <span>
            {loading ? 'Loading...' : `${messages.length} messages`}
          </span>
          <span>{accounts.length} account(s) connected</span>
        </div>
      </div>

      {showAddAccount && (
        <AddAccountDialog
          onClose={() => setShowAddAccount(false)}
          onAccountAdded={refreshAccounts}
        />
      )}
    </div>
  )
}

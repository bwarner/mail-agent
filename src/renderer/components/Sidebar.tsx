import React, { useState, useEffect } from 'react'
import type { EmailAccount, FolderInfo } from '../../shared/types'

interface SidebarProps {
  accounts: EmailAccount[]
  activeView: string
  onViewChange: (view: string) => void
  onCompose: () => void
  onFolderSelect: (accountId: string, folderId: string) => void
}

export function Sidebar({
  accounts,
  activeView,
  onViewChange,
  onCompose,
  onFolderSelect
}: SidebarProps) {
  const [folders, setFolders] = useState<Map<string, FolderInfo[]>>(new Map())
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set())

  useEffect(() => {
    for (const account of accounts) {
      if (account.enabled) {
        window.mailAgent.accounts.folders(account.account_id).then((f) => {
          setFolders((prev) => new Map(prev).set(account.account_id, f))
        })
      }
    }
  }, [accounts])

  const toggleAccount = (accountId: string) => {
    setExpandedAccounts((prev) => {
      const next = new Set(prev)
      if (next.has(accountId)) next.delete(accountId)
      else next.add(accountId)
      return next
    })
  }

  const systemFolderOrder = ['INBOX', 'Inbox', 'STARRED', 'SENT', 'SentItems', 'DRAFT', 'Drafts', 'TRASH', 'DeletedItems', 'SPAM', 'Junk']

  const sortFolders = (fList: FolderInfo[]) => {
    const system = fList.filter((f) => f.type === 'system')
      .sort((a, b) => {
        const ai = systemFolderOrder.indexOf(a.name)
        const bi = systemFolderOrder.indexOf(b.name)
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi)
      })
    const user = fList.filter((f) => f.type === 'user')
      .sort((a, b) => a.name.localeCompare(b.name))
    return [...system, ...user]
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Mail Agent</h1>
        <button className="btn btn-primary compose-btn" onClick={onCompose}>
          Compose
        </button>
      </div>

      <nav className="sidebar-nav">
        <button
          className={`nav-item ${activeView === 'inbox' ? 'active' : ''}`}
          onClick={() => onViewChange('inbox')}
        >
          Inbox
        </button>
        <button
          className={`nav-item ${activeView === 'rules' ? 'active' : ''}`}
          onClick={() => onViewChange('rules')}
        >
          Rules
        </button>
        <button
          className={`nav-item ${activeView === 'agents' ? 'active' : ''}`}
          onClick={() => onViewChange('agents')}
        >
          Agents
        </button>
        <button
          className={`nav-item ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => onViewChange('settings')}
        >
          Settings
        </button>
      </nav>

      <div className="sidebar-accounts">
        <h3>Accounts</h3>
        {accounts.length === 0 && (
          <div className="account-item">No accounts configured</div>
        )}
        {accounts.map((account) => {
          const expanded = expandedAccounts.has(account.account_id)
          const accountFolders = folders.get(account.account_id) ?? []
          const sorted = sortFolders(accountFolders)

          return (
            <div key={account.account_id} className="account-section">
              <button
                className="account-item account-toggle"
                onClick={() => toggleAccount(account.account_id)}
              >
                <span className={`account-dot ${account.enabled ? '' : 'disabled'}`} />
                <span className="account-email">{account.email_address}</span>
                <span className="account-chevron">{expanded ? '-' : '+'}</span>
              </button>

              {expanded && sorted.length > 0 && (
                <div className="folder-list">
                  {sorted.map((folder) => (
                    <button
                      key={folder.id}
                      className="folder-item"
                      onClick={() => onFolderSelect(account.account_id, folder.id)}
                    >
                      <span className="folder-name">{folder.name}</span>
                      {folder.unread_count > 0 && (
                        <span className="folder-badge">{folder.unread_count}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

import React from 'react'
import type { EmailAccount } from '../../shared/types'

interface SidebarProps {
  accounts: EmailAccount[]
  activeView: string
  onViewChange: (view: string) => void
}

export function Sidebar({ accounts, activeView, onViewChange }: SidebarProps) {
  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h1>Mail Agent</h1>
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
        {accounts.map((account) => (
          <div key={account.account_id} className="account-item">
            <span className={`account-dot ${account.enabled ? '' : 'disabled'}`} />
            <span>{account.email_address}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

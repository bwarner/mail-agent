import React, { useState, useEffect } from 'react'
import type { Provider } from '../../shared/types'

interface AddAccountDialogProps {
  onClose: () => void
  onAccountAdded: () => void
}

type Step = 'choose-provider' | 'imap-config' | 'connecting' | 'success' | 'error'

export function AddAccountDialog({ onClose, onAccountAdded }: AddAccountDialogProps) {
  const [step, setStep] = useState<Step>('choose-provider')
  const [error, setError] = useState('')
  const [addedEmail, setAddedEmail] = useState('')
  const [availableProviders, setAvailableProviders] = useState<{ gmail: boolean; outlook: boolean }>({ gmail: false, outlook: false })

  // IMAP config state
  const [email, setEmail] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [imapHost, setImapHost] = useState('')
  const [imapPort, setImapPort] = useState(993)
  const [smtpHost, setSmtpHost] = useState('')
  const [smtpPort, setSmtpPort] = useState(587)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [useTls, setUseTls] = useState(true)

  useEffect(() => {
    window.mailAgent.auth.providers().then(setAvailableProviders).catch(() => {})
  }, [])

  const handleOAuthConnect = async (provider: Provider) => {
    setStep('connecting')
    setError('')
    try {
      const account = await window.mailAgent.auth.startOAuth(provider)
      setAddedEmail(account.email_address)
      setStep('success')
      onAccountAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  const handleImapConnect = async () => {
    if (!email || !imapHost || !smtpHost || !username || !password) return
    setStep('connecting')
    setError('')
    try {
      const account = await window.mailAgent.auth.addImap({
        email, displayName: displayName || email,
        imapHost, imapPort, smtpHost, smtpPort,
        username, password, useTls
      })
      setAddedEmail(account.email_address)
      setStep('success')
      onAccountAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('error')
    }
  }

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ width: step === 'imap-config' ? 520 : 480 }}>
        <div className="dialog-header">
          <h2>Add Email Account</h2>
          <button className="dialog-close" onClick={onClose}>&times;</button>
        </div>

        {step === 'choose-provider' && (
          <div className="dialog-body">
            <p className="dialog-description">
              Choose your email provider. OAuth providers open your browser for secure sign-in.
            </p>
            <div className="provider-grid">
              <button
                className="provider-card"
                onClick={() => handleOAuthConnect('gmail')}
                disabled={!availableProviders.gmail}
              >
                <div className="provider-name">Gmail</div>
                <div className="provider-desc">
                  {availableProviders.gmail ? 'Google & Workspace' : 'Not configured'}
                </div>
              </button>
              <button
                className="provider-card"
                onClick={() => handleOAuthConnect('outlook')}
                disabled={!availableProviders.outlook}
              >
                <div className="provider-name">Outlook</div>
                <div className="provider-desc">
                  {availableProviders.outlook ? 'Microsoft 365' : 'Not configured'}
                </div>
              </button>
              <button
                className="provider-card"
                onClick={() => setStep('imap-config')}
              >
                <div className="provider-name">IMAP / SMTP</div>
                <div className="provider-desc">Any email provider</div>
              </button>
            </div>
          </div>
        )}

        {step === 'imap-config' && (
          <div className="dialog-body">
            <p className="dialog-description">
              Enter your email server details. Your password is encrypted and stored locally.
            </p>
            <div className="dialog-fields">
              <div className="compose-field">
                <label>Email</label>
                <input className="compose-input" value={email}
                  onChange={(e) => { setEmail(e.target.value); if (!username) setUsername(e.target.value) }}
                  placeholder="you@example.com" />
              </div>
              <div className="compose-field">
                <label>Name</label>
                <input className="compose-input" value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  placeholder="Display name (optional)" />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="compose-field" style={{ flex: 1 }}>
                  <label>IMAP</label>
                  <input className="compose-input" value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                    placeholder="imap.example.com" />
                </div>
                <input className="compose-input" style={{ width: '70px' }} type="number" value={imapPort}
                  onChange={(e) => setImapPort(Number(e.target.value))} />
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <div className="compose-field" style={{ flex: 1 }}>
                  <label>SMTP</label>
                  <input className="compose-input" value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                    placeholder="smtp.example.com" />
                </div>
                <input className="compose-input" style={{ width: '70px' }} type="number" value={smtpPort}
                  onChange={(e) => setSmtpPort(Number(e.target.value))} />
              </div>
              <div className="compose-field">
                <label>User</label>
                <input className="compose-input" value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Username (usually your email)" />
              </div>
              <div className="compose-field">
                <label>Password</label>
                <input className="compose-input" type="password" value={password}
                  onChange={(e) => setPassword(e.target.value)} />
              </div>
              <div className="compose-field">
                <label>TLS</label>
                <input type="checkbox" checked={useTls} onChange={(e) => setUseTls(e.target.checked)} />
                <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Use TLS/SSL</span>
              </div>
            </div>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setStep('choose-provider')}>Back</button>
              <button className="btn btn-primary" onClick={handleImapConnect}
                disabled={!email || !imapHost || !smtpHost || !password}>
                Connect
              </button>
            </div>
          </div>
        )}

        {step === 'connecting' && (
          <div className="dialog-body dialog-center">
            <div className="dialog-spinner" />
            <p>Connecting...</p>
            <p className="dialog-subdesc">Testing connection to your email server.</p>
          </div>
        )}

        {step === 'success' && (
          <div className="dialog-body dialog-center">
            <div className="dialog-success-icon">+</div>
            <h3>Account Connected</h3>
            <p>{addedEmail}</p>
            <p className="dialog-subdesc" style={{ marginTop: '8px' }}>
              Click Sync to start pulling emails.
            </p>
            <button className="btn btn-primary" onClick={onClose} style={{ marginTop: '16px' }}>
              Done
            </button>
          </div>
        )}

        {step === 'error' && (
          <div className="dialog-body dialog-center">
            <div className="dialog-error-icon">!</div>
            <h3>Connection Failed</h3>
            <p className="dialog-error-text">{error}</p>
            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setStep(email ? 'imap-config' : 'choose-provider')}>
                Try Again
              </button>
              <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

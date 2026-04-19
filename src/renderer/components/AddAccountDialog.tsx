import React, { useState } from 'react'
import type { Provider } from '../../shared/types'

interface AddAccountDialogProps {
  onClose: () => void
  onAccountAdded: () => void
}

type Step = 'choose-provider' | 'enter-credentials' | 'connecting' | 'success' | 'error'

export function AddAccountDialog({ onClose, onAccountAdded }: AddAccountDialogProps) {
  const [step, setStep] = useState<Step>('choose-provider')
  const [provider, setProvider] = useState<Provider | null>(null)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [error, setError] = useState('')
  const [addedEmail, setAddedEmail] = useState('')

  const handleProviderSelect = (p: Provider) => {
    setProvider(p)
    setStep('enter-credentials')
  }

  const handleConnect = async () => {
    if (!provider || !clientId) return
    setStep('connecting')
    setError('')

    try {
      await window.mailAgent.auth.configure(provider, {
        clientId,
        clientSecret
      })

      const account = await window.mailAgent.auth.startOAuth(provider)
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
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Add Email Account</h2>
          <button className="dialog-close" onClick={onClose}>&times;</button>
        </div>

        {step === 'choose-provider' && (
          <div className="dialog-body">
            <p className="dialog-description">Choose your email provider:</p>
            <div className="provider-grid">
              <button className="provider-card" onClick={() => handleProviderSelect('gmail')}>
                <div className="provider-name">Gmail</div>
                <div className="provider-desc">Google Workspace & Gmail accounts</div>
              </button>
              <button className="provider-card" onClick={() => handleProviderSelect('outlook')}>
                <div className="provider-name">Outlook</div>
                <div className="provider-desc">Microsoft 365 & Outlook.com accounts</div>
              </button>
            </div>
          </div>
        )}

        {step === 'enter-credentials' && (
          <div className="dialog-body">
            <p className="dialog-description">
              Enter your {provider === 'gmail' ? 'Google Cloud' : 'Azure AD'} OAuth credentials.
              {provider === 'gmail'
                ? ' Create them at console.cloud.google.com under APIs & Services > Credentials.'
                : ' Create them at portal.azure.com under App registrations.'}
            </p>

            <div className="dialog-fields">
              <div className="compose-field">
                <label>Client ID</label>
                <input
                  className="compose-input"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  placeholder={provider === 'gmail' ? 'xxxxx.apps.googleusercontent.com' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}
                />
              </div>
              <div className="compose-field">
                <label>Secret</label>
                <input
                  className="compose-input"
                  type="password"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  placeholder="Client secret"
                />
              </div>
            </div>

            <div className="dialog-actions">
              <button className="btn btn-secondary" onClick={() => setStep('choose-provider')}>
                Back
              </button>
              <button
                className="btn btn-primary"
                onClick={handleConnect}
                disabled={!clientId}
              >
                Connect
              </button>
            </div>
          </div>
        )}

        {step === 'connecting' && (
          <div className="dialog-body dialog-center">
            <div className="dialog-spinner" />
            <p>Opening browser for authentication...</p>
            <p className="dialog-subdesc">Sign in and authorize Mail Agent in the browser window.</p>
          </div>
        )}

        {step === 'success' && (
          <div className="dialog-body dialog-center">
            <div className="dialog-success-icon">+</div>
            <h3>Account Connected</h3>
            <p>{addedEmail}</p>
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
              <button className="btn btn-secondary" onClick={() => setStep('enter-credentials')}>
                Try Again
              </button>
              <button className="btn btn-secondary" onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

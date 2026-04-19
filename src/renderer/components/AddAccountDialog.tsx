import React, { useState, useEffect } from 'react'
import type { Provider } from '../../shared/types'

interface AddAccountDialogProps {
  onClose: () => void
  onAccountAdded: () => void
}

type Step = 'choose-provider' | 'connecting' | 'success' | 'error'

export function AddAccountDialog({ onClose, onAccountAdded }: AddAccountDialogProps) {
  const [step, setStep] = useState<Step>('choose-provider')
  const [error, setError] = useState('')
  const [addedEmail, setAddedEmail] = useState('')
  const [availableProviders, setAvailableProviders] = useState<{ gmail: boolean; outlook: boolean }>({ gmail: false, outlook: false })

  useEffect(() => {
    window.mailAgent.auth.providers().then(setAvailableProviders).catch(() => {})
  }, [])

  const handleConnect = async (provider: Provider) => {
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

  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Add Email Account</h2>
          <button className="dialog-close" onClick={onClose}>&times;</button>
        </div>

        {step === 'choose-provider' && (
          <div className="dialog-body">
            <p className="dialog-description">
              Choose your email provider. You'll be redirected to sign in securely in your browser.
            </p>
            <div className="provider-grid">
              <button
                className="provider-card"
                onClick={() => handleConnect('gmail')}
                disabled={!availableProviders.gmail}
              >
                <div className="provider-name">Gmail</div>
                <div className="provider-desc">
                  {availableProviders.gmail
                    ? 'Google Workspace & Gmail accounts'
                    : 'Not configured by developer'}
                </div>
              </button>
              <button
                className="provider-card"
                onClick={() => handleConnect('outlook')}
                disabled={!availableProviders.outlook}
              >
                <div className="provider-name">Outlook</div>
                <div className="provider-desc">
                  {availableProviders.outlook
                    ? 'Microsoft 365 & Outlook.com accounts'
                    : 'Not configured by developer'}
                </div>
              </button>
            </div>
          </div>
        )}

        {step === 'connecting' && (
          <div className="dialog-body dialog-center">
            <div className="dialog-spinner" />
            <p>Opening your browser...</p>
            <p className="dialog-subdesc">Sign in and authorize Mail Agent. This window will update automatically.</p>
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
              <button className="btn btn-secondary" onClick={() => setStep('choose-provider')}>
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

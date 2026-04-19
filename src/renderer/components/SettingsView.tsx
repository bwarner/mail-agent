import React, { useState, useEffect } from 'react'
import type { EmailAccount } from '../../shared/types'

export function SettingsView() {
  const [tab, setTab] = useState<'accounts' | 'embeddings' | 'general'>('accounts')
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [embeddingEndpoint, setEmbeddingEndpoint] = useState('http://localhost:11434')
  const [embeddingModel, setEmbeddingModel] = useState('nomic-embed-text')
  const [embeddingType, setEmbeddingType] = useState<'ollama' | 'openai'>('ollama')
  const [embeddingKey, setEmbeddingKey] = useState('')
  const [embeddingDims, setEmbeddingDims] = useState(768)
  const [embeddingStats, setEmbeddingStats] = useState<{ unembedded: number } | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    window.mailAgent.accounts.list().then((a) => setAccounts(Array.isArray(a) ? a : []))
    window.mailAgent.embeddings.stats().then(setEmbeddingStats).catch(() => {})
  }, [])

  const handleRemoveAccount = async (id: string) => {
    await window.mailAgent.accounts.remove(id)
    const updated = await window.mailAgent.accounts.list()
    setAccounts(Array.isArray(updated) ? updated : [])
  }

  const handleSaveEmbeddings = async () => {
    await window.mailAgent.embeddings.configure({
      type: embeddingType,
      endpoint: embeddingEndpoint,
      model: embeddingModel,
      apiKey: embeddingKey || undefined,
      dimensions: embeddingDims
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const handleBackfill = async () => {
    setBackfilling(true)
    try {
      const result = await window.mailAgent.embeddings.backfill()
      setEmbeddingStats({ unembedded: result.remaining })
    } finally {
      setBackfilling(false)
    }
  }

  return (
    <div className="settings-view">
      <div className="settings-tabs">
        <button className={`settings-tab ${tab === 'accounts' ? 'active' : ''}`} onClick={() => setTab('accounts')}>
          Accounts
        </button>
        <button className={`settings-tab ${tab === 'embeddings' ? 'active' : ''}`} onClick={() => setTab('embeddings')}>
          Embeddings
        </button>
        <button className={`settings-tab ${tab === 'general' ? 'active' : ''}`} onClick={() => setTab('general')}>
          General
        </button>
      </div>

      <div className="settings-content">
        {tab === 'accounts' && (
          <div className="settings-section">
            <h3>Connected Accounts</h3>
            {accounts.length === 0 ? (
              <p className="dialog-description">No accounts connected. Use the "+ Add" button in the sidebar.</p>
            ) : (
              <div className="settings-list">
                {accounts.map((acc) => (
                  <div key={acc.account_id} className="settings-list-item">
                    <div>
                      <div className="settings-item-title">{acc.email_address}</div>
                      <div className="settings-item-sub">
                        {acc.provider} — {acc.enabled ? 'Active' : 'Disabled'}
                        {acc.last_sync && ` — Last sync: ${new Date(acc.last_sync).toLocaleString()}`}
                      </div>
                    </div>
                    <button className="btn-action" onClick={() => handleRemoveAccount(acc.account_id)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'embeddings' && (
          <div className="settings-section">
            <h3>Embedding Provider</h3>
            <p className="dialog-description">
              Configure how email text is embedded for semantic search. Ollama runs locally and is free.
            </p>

            <div className="settings-form">
              <div className="compose-field">
                <label>Provider</label>
                <select className="compose-select" value={embeddingType} onChange={(e) => setEmbeddingType(e.target.value as any)}>
                  <option value="ollama">Ollama (local)</option>
                  <option value="openai">OpenAI / compatible</option>
                </select>
              </div>
              <div className="compose-field">
                <label>Endpoint</label>
                <input className="compose-input" value={embeddingEndpoint} onChange={(e) => setEmbeddingEndpoint(e.target.value)} />
              </div>
              <div className="compose-field">
                <label>Model</label>
                <input className="compose-input" value={embeddingModel} onChange={(e) => setEmbeddingModel(e.target.value)}
                  placeholder={embeddingType === 'ollama' ? 'nomic-embed-text' : 'text-embedding-3-small'} />
              </div>
              <div className="compose-field">
                <label>Dims</label>
                <input className="compose-input" type="number" value={embeddingDims} onChange={(e) => setEmbeddingDims(Number(e.target.value))} />
              </div>
              {embeddingType === 'openai' && (
                <div className="compose-field">
                  <label>API Key</label>
                  <input className="compose-input" type="password" value={embeddingKey} onChange={(e) => setEmbeddingKey(e.target.value)} />
                </div>
              )}

              <div className="dialog-actions">
                <button className="btn btn-primary" onClick={handleSaveEmbeddings}>
                  {saved ? 'Saved' : 'Save'}
                </button>
              </div>
            </div>

            <div className="settings-section" style={{ marginTop: '24px' }}>
              <h3>Embedding Backfill</h3>
              <p className="dialog-description">
                {embeddingStats
                  ? `${embeddingStats.unembedded} messages without embeddings.`
                  : 'Loading stats...'}
              </p>
              <button className="btn btn-secondary" onClick={handleBackfill} disabled={backfilling}>
                {backfilling ? 'Embedding...' : 'Backfill Now'}
              </button>
            </div>
          </div>
        )}

        {tab === 'general' && (
          <div className="settings-section">
            <h3>General</h3>
            <div className="settings-list-item">
              <div>
                <div className="settings-item-title">Mail Agent</div>
                <div className="settings-item-sub">v0.1.0 — Local-first email client + intelligent agent</div>
              </div>
            </div>
            <div className="settings-list-item">
              <div>
                <div className="settings-item-title">Database</div>
                <div className="settings-item-sub">Turso (libSQL / SQLite) with vector search</div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

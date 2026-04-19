import React, { useState, useEffect } from 'react'
import type { EmailAccount } from '../../shared/types'

export function SettingsView() {
  const [tab, setTab] = useState<'accounts' | 'llm' | 'embeddings' | 'general'>('accounts')
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [embeddingEndpoint, setEmbeddingEndpoint] = useState('http://localhost:11434')
  const [embeddingModel, setEmbeddingModel] = useState('nomic-embed-text')
  const [embeddingType, setEmbeddingType] = useState<'ollama' | 'openai'>('ollama')
  const [embeddingKey, setEmbeddingKey] = useState('')
  const [embeddingDims, setEmbeddingDims] = useState(768)
  const [embeddingStats, setEmbeddingStats] = useState<{ unembedded: number } | null>(null)
  const [backfilling, setBackfilling] = useState(false)
  const [saved, setSaved] = useState(false)

  // LLM state
  const [llmProviders, setLlmProviders] = useState<any[]>([])
  const [llmType, setLlmType] = useState<'ollama' | 'anthropic' | 'openai' | 'custom'>('ollama')
  const [llmEndpoint, setLlmEndpoint] = useState('http://localhost:11434')
  const [llmModel, setLlmModel] = useState('llama3')
  const [llmKey, setLlmKey] = useState('')
  const [llmName, setLlmName] = useState('Ollama')
  const [llmTestResult, setLlmTestResult] = useState<string | null>(null)

  useEffect(() => {
    window.mailAgent.accounts.list().then((a) => setAccounts(Array.isArray(a) ? a : []))
    window.mailAgent.embeddings.stats().then(setEmbeddingStats).catch(() => {})
    window.mailAgent.llm.listProviders().then((p) => setLlmProviders(Array.isArray(p) ? p : [])).catch(() => {})
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
        <button className={`settings-tab ${tab === 'llm' ? 'active' : ''}`} onClick={() => setTab('llm')}>
          LLM
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

        {tab === 'llm' && (
          <div className="settings-section">
            <h3>LLM Provider</h3>
            <p className="dialog-description">
              Configure an LLM for intelligent email analysis. Rules with "use LLM" enabled will use this provider.
              Ollama is free and runs locally.
            </p>

            {llmProviders.length > 0 && (
              <div className="settings-list" style={{ marginBottom: '20px' }}>
                {llmProviders.map((p: any) => (
                  <div key={p.provider_id} className="settings-list-item">
                    <div>
                      <div className="settings-item-title">{p.name}</div>
                      <div className="settings-item-sub">{p.type} — {p.model} — {p.enabled ? 'Active' : 'Inactive'}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn-action" onClick={async () => {
                        const result = await window.mailAgent.llm.test(p.provider_id)
                        setLlmTestResult(result.success ? `OK: ${result.response}` : `Error: ${result.error}`)
                      }}>Test</button>
                      <button className="btn-action" onClick={async () => {
                        await window.mailAgent.llm.setActive(p.provider_id)
                        const updated = await window.mailAgent.llm.listProviders()
                        setLlmProviders(Array.isArray(updated) ? updated : [])
                      }}>Activate</button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {llmTestResult && (
              <p style={{ fontSize: '13px', color: llmTestResult.startsWith('OK') ? 'var(--success)' : 'var(--accent)', marginBottom: '12px' }}>
                {llmTestResult}
              </p>
            )}

            <h4 style={{ marginTop: '16px', marginBottom: '8px' }}>Add Provider</h4>
            <div className="settings-form">
              <div className="compose-field">
                <label>Name</label>
                <input className="compose-input" value={llmName} onChange={(e) => setLlmName(e.target.value)} />
              </div>
              <div className="compose-field">
                <label>Type</label>
                <select className="compose-select" value={llmType} onChange={(e) => {
                  const t = e.target.value as any
                  setLlmType(t)
                  if (t === 'ollama') { setLlmEndpoint('http://localhost:11434'); setLlmModel('llama3'); setLlmName('Ollama') }
                  if (t === 'anthropic') { setLlmEndpoint('https://api.anthropic.com'); setLlmModel('claude-sonnet-4-20250514'); setLlmName('Claude') }
                  if (t === 'openai') { setLlmEndpoint('https://api.openai.com'); setLlmModel('gpt-4o'); setLlmName('OpenAI') }
                }}>
                  <option value="ollama">Ollama (local)</option>
                  <option value="anthropic">Anthropic (Claude)</option>
                  <option value="openai">OpenAI</option>
                  <option value="custom">Custom (OpenAI-compatible)</option>
                </select>
              </div>
              <div className="compose-field">
                <label>Endpoint</label>
                <input className="compose-input" value={llmEndpoint} onChange={(e) => setLlmEndpoint(e.target.value)} />
              </div>
              <div className="compose-field">
                <label>Model</label>
                <input className="compose-input" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} />
              </div>
              {llmType !== 'ollama' && (
                <div className="compose-field">
                  <label>API Key</label>
                  <input className="compose-input" type="password" value={llmKey} onChange={(e) => setLlmKey(e.target.value)} />
                </div>
              )}
              <div className="dialog-actions">
                <button className="btn btn-primary" onClick={async () => {
                  const provider = {
                    provider_id: `${llmType}_${Date.now()}`,
                    name: llmName,
                    type: llmType,
                    endpoint: llmEndpoint,
                    model: llmModel,
                    api_key_ref: llmKey || undefined,
                    max_tokens: 4096,
                    temperature: 0.7,
                    enabled: true
                  }
                  await window.mailAgent.llm.saveProvider(provider)
                  const updated = await window.mailAgent.llm.listProviders()
                  setLlmProviders(Array.isArray(updated) ? updated : [])
                }}>Add Provider</button>
              </div>
            </div>
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

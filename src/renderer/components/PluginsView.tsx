import React, { useState, useEffect, useCallback } from 'react'
import type { PluginInfo } from '../../shared/plugin-types'

export function PluginsView() {
  const [plugins, setPlugins] = useState<PluginInfo[]>([])
  const [selected, setSelected] = useState<PluginInfo | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const list = await window.mailAgent.plugins.list()
      setPlugins(list)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleToggle = async (plugin: PluginInfo) => {
    if (plugin.enabled) {
      await window.mailAgent.plugins.disable(plugin.manifest.name)
    } else {
      await window.mailAgent.plugins.enable(plugin.manifest.name)
    }
    await refresh()
  }

  const handleReload = async () => {
    await window.mailAgent.plugins.reload()
    await refresh()
  }

  if (loading) {
    return <div className="empty-state">Loading plugins...</div>
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div className="plugin-list-panel">
        <div className="plugin-list-header">
          <h3>Plugins</h3>
          <button className="btn btn-secondary" onClick={handleReload}>
            Reload
          </button>
        </div>

        {plugins.length === 0 ? (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div>No plugins installed</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
              Add plugins to ~/.mail-agent/plugins/
            </div>
          </div>
        ) : (
          <div className="plugin-list">
            {plugins.map((plugin) => (
              <div
                key={plugin.manifest.name}
                className={`plugin-item ${selected?.manifest.name === plugin.manifest.name ? 'selected' : ''}`}
                onClick={() => setSelected(plugin)}
              >
                <div className="plugin-item-header">
                  <span className="plugin-name">{plugin.manifest.displayName}</span>
                  <span className={`plugin-status ${plugin.enabled ? 'enabled' : ''} ${plugin.error ? 'error' : ''}`}>
                    {plugin.error ? 'Error' : plugin.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                </div>
                <div className="plugin-description">{plugin.manifest.description}</div>
                <div className="plugin-meta">
                  <span className="tag">{plugin.manifest.type}</span>
                  <span>v{plugin.manifest.version}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="plugin-detail-panel">
        {selected ? (
          <PluginDetail plugin={selected} onToggle={() => handleToggle(selected)} />
        ) : (
          <div className="empty-state">Select a plugin to view details</div>
        )}
      </div>
    </div>
  )
}

function PluginDetail({ plugin, onToggle }: { plugin: PluginInfo; onToggle: () => void }) {
  return (
    <div className="plugin-detail">
      <div className="plugin-detail-header">
        <h2>{plugin.manifest.displayName}</h2>
        <button
          className={`btn ${plugin.enabled ? 'btn-secondary' : 'btn-primary'}`}
          onClick={onToggle}
          disabled={!!plugin.error}
        >
          {plugin.enabled ? 'Disable' : 'Enable'}
        </button>
      </div>

      <div className="plugin-detail-section">
        <div className="plugin-detail-row">
          <span className="plugin-detail-label">Name</span>
          <span>{plugin.manifest.name}</span>
        </div>
        <div className="plugin-detail-row">
          <span className="plugin-detail-label">Version</span>
          <span>{plugin.manifest.version}</span>
        </div>
        <div className="plugin-detail-row">
          <span className="plugin-detail-label">Author</span>
          <span>{plugin.manifest.author}</span>
        </div>
        <div className="plugin-detail-row">
          <span className="plugin-detail-label">Type</span>
          <span className="tag">{plugin.manifest.type}</span>
        </div>
        <div className="plugin-detail-row">
          <span className="plugin-detail-label">License</span>
          <span>{plugin.manifest.license}</span>
        </div>
      </div>

      <div className="plugin-detail-section">
        <h4>Description</h4>
        <p>{plugin.manifest.description}</p>
      </div>

      <div className="plugin-detail-section">
        <h4>Permissions</h4>
        <div className="plugin-permissions">
          {plugin.manifest.permissions.map((perm) => (
            <span key={perm} className="tag">{perm}</span>
          ))}
        </div>
      </div>

      {plugin.error && (
        <div className="plugin-detail-section plugin-error-section">
          <h4>Error</h4>
          <pre className="plugin-error">{plugin.error}</pre>
        </div>
      )}

      {plugin.manifest.config_schema && (
        <div className="plugin-detail-section">
          <h4>Configuration</h4>
          <pre className="plugin-config">
            {JSON.stringify(plugin.config, null, 2) || '{}'}
          </pre>
        </div>
      )}

      <div className="plugin-detail-section">
        <h4>Location</h4>
        <code className="plugin-path">{plugin.path}</code>
      </div>
    </div>
  )
}

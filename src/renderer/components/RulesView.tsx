import React, { useState, useEffect, useCallback } from 'react'
import type { Rule, RuleCondition, RuleAction, RuleCombinator, RuleOperator } from '../../shared/types'
import { randomId } from '../util'

export function RulesView() {
  const [rules, setRules] = useState<Rule[]>([])
  const [editing, setEditing] = useState<Rule | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.mailAgent.rules.list()
      setRules(Array.isArray(result) ? result : [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleNew = () => {
    setEditing({
      rule_id: '',
      name: '',
      priority: (rules.length + 1) * 10,
      enabled: true,
      conditions: { combinator: 'any', items: [{ field: 'subject', op: 'contains', value: '' }] },
      actions: [{ type: 'tag', value: '' }],
      use_llm: false
    })
  }

  const handleSave = async (rule: Rule) => {
    await window.mailAgent.rules.upsert(rule)
    setEditing(null)
    await refresh()
  }

  const handleDelete = async (ruleId: string) => {
    await window.mailAgent.rules.delete(ruleId)
    setEditing(null)
    await refresh()
  }

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
      <div className="plugin-list-panel">
        <div className="plugin-list-header">
          <h3>Rules</h3>
          <button className="btn btn-primary" onClick={handleNew}>+ New</button>
        </div>
        {rules.length === 0 && !loading ? (
          <div className="empty-state" style={{ padding: '40px 20px' }}>
            <div>No rules defined</div>
            <div style={{ fontSize: '13px', color: 'var(--text-secondary)', marginTop: '8px' }}>
              Create rules to classify and route email
            </div>
          </div>
        ) : (
          <div className="plugin-list">
            {rules.map((rule) => (
              <div
                key={rule.rule_id}
                className={`plugin-item ${editing?.rule_id === rule.rule_id ? 'selected' : ''}`}
                onClick={() => setEditing({ ...rule })}
              >
                <div className="plugin-item-header">
                  <span className="plugin-name">{rule.name || '(unnamed)'}</span>
                  <span className="tag">P{rule.priority}</span>
                </div>
                <div className="plugin-description">
                  {rule.conditions.items.length} condition(s), {rule.actions.length} action(s)
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="plugin-detail-panel">
        {editing ? (
          <RuleEditor rule={editing} onSave={handleSave} onDelete={handleDelete} onCancel={() => setEditing(null)} />
        ) : (
          <div className="empty-state">Select or create a rule</div>
        )}
      </div>
    </div>
  )
}

const FIELDS = ['subject', 'from_address', 'from_name', 'body_text', 'headers.List-Unsubscribe', 'attachments', 'labels']
const OPS: RuleOperator[] = ['contains', 'equals', 'matches', 'regex', 'exists', 'has_type']
const COMBINATORS: RuleCombinator[] = ['any', 'all', 'none']
const ACTION_TYPES = ['tag', 'route_to', 'extract'] as const

function RuleEditor({ rule, onSave, onDelete, onCancel }: {
  rule: Rule
  onSave: (rule: Rule) => void
  onDelete: (id: string) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<Rule>(rule)

  const update = (partial: Partial<Rule>) => setDraft((d) => ({ ...d, ...partial }))

  const updateCondition = (idx: number, patch: Partial<RuleCondition>) => {
    const items = [...draft.conditions.items]
    items[idx] = { ...items[idx], ...patch }
    update({ conditions: { ...draft.conditions, items } })
  }

  const addCondition = () => {
    update({
      conditions: {
        ...draft.conditions,
        items: [...draft.conditions.items, { field: 'subject', op: 'contains', value: '' }]
      }
    })
  }

  const removeCondition = (idx: number) => {
    const items = draft.conditions.items.filter((_, i) => i !== idx)
    update({ conditions: { ...draft.conditions, items } })
  }

  const updateAction = (idx: number, patch: Partial<RuleAction>) => {
    const actions = [...draft.actions]
    actions[idx] = { ...actions[idx], ...patch }
    update({ actions })
  }

  const addAction = () => {
    update({ actions: [...draft.actions, { type: 'tag', value: '' }] })
  }

  const removeAction = (idx: number) => {
    update({ actions: draft.actions.filter((_, i) => i !== idx) })
  }

  return (
    <div className="plugin-detail" style={{ paddingBottom: '40px' }}>
      <div className="plugin-detail-header">
        <h2>{rule.rule_id ? 'Edit Rule' : 'New Rule'}</h2>
      </div>

      <div className="settings-form">
        <div className="compose-field">
          <label>Name</label>
          <input className="compose-input" value={draft.name} onChange={(e) => update({ name: e.target.value })} placeholder="e.g. Invoices" />
        </div>
        <div className="compose-field">
          <label>Priority</label>
          <input className="compose-input" type="number" value={draft.priority} onChange={(e) => update({ priority: Number(e.target.value) })} />
        </div>
        <div className="compose-field">
          <label>Enabled</label>
          <input type="checkbox" checked={draft.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
        </div>
      </div>

      <div className="settings-section" style={{ marginTop: '20px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
          <h4 style={{ margin: 0 }}>Conditions — match</h4>
          <select className="compose-select" style={{ width: 'auto' }}
            value={draft.conditions.combinator}
            onChange={(e) => update({ conditions: { ...draft.conditions, combinator: e.target.value as RuleCombinator } })}>
            {COMBINATORS.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {draft.conditions.items.map((cond, idx) => (
          <div key={idx} className="rule-condition-row">
            <select className="compose-select" value={cond.field} onChange={(e) => updateCondition(idx, { field: e.target.value })}>
              {FIELDS.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
            <select className="compose-select" value={cond.op} onChange={(e) => updateCondition(idx, { op: e.target.value as RuleOperator })}>
              {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            {cond.op !== 'exists' && (
              <input className="compose-input" value={cond.value ?? ''} onChange={(e) => updateCondition(idx, { value: e.target.value })} placeholder="value" />
            )}
            <button className="btn-action" onClick={() => removeCondition(idx)}>x</button>
          </div>
        ))}
        <button className="btn-action" onClick={addCondition} style={{ marginTop: '8px' }}>+ Condition</button>
      </div>

      <div className="settings-section" style={{ marginTop: '20px' }}>
        <h4>Actions</h4>
        {draft.actions.map((action, idx) => (
          <div key={idx} className="rule-condition-row">
            <select className="compose-select" value={action.type} onChange={(e) => updateAction(idx, { type: e.target.value as any })}>
              {ACTION_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <input className="compose-input" value={typeof action.value === 'string' ? action.value : (action.value as string[]).join(', ')}
              onChange={(e) => updateAction(idx, {
                value: action.type === 'extract' ? e.target.value.split(',').map((s) => s.trim()) : e.target.value
              })}
              placeholder={action.type === 'tag' ? 'tag name' : action.type === 'route_to' ? 'plugin name' : 'field1, field2'} />
            <button className="btn-action" onClick={() => removeAction(idx)}>x</button>
          </div>
        ))}
        <button className="btn-action" onClick={addAction} style={{ marginTop: '8px' }}>+ Action</button>
      </div>

      <div className="dialog-actions" style={{ marginTop: '24px' }}>
        {rule.rule_id && (
          <button className="btn btn-secondary" style={{ color: 'var(--accent)' }} onClick={() => onDelete(rule.rule_id)}>
            Delete
          </button>
        )}
        <div style={{ flex: 1 }} />
        <button className="btn btn-secondary" onClick={onCancel}>Cancel</button>
        <button className="btn btn-primary" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>Save</button>
      </div>
    </div>
  )
}

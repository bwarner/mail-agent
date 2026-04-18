import { contextBridge, ipcRenderer } from 'electron'
import type { EmailAccount, ProcessedMessage, Rule } from '../shared/types'

const api = {
  accounts: {
    list: (): Promise<EmailAccount[]> =>
      ipcRenderer.invoke('accounts:list'),
    add: (account: Omit<EmailAccount, 'account_id'>): Promise<EmailAccount> =>
      ipcRenderer.invoke('accounts:add', account),
    remove: (accountId: string): Promise<void> =>
      ipcRenderer.invoke('accounts:remove', accountId),
    sync: (accountId: string): Promise<{ processed: number; errors: number }> =>
      ipcRenderer.invoke('accounts:sync', accountId)
  },
  messages: {
    list: (opts: { accountId?: string; limit?: number; offset?: number }): Promise<ProcessedMessage[]> =>
      ipcRenderer.invoke('messages:list', opts),
    search: (query: string): Promise<ProcessedMessage[]> =>
      ipcRenderer.invoke('messages:search', query),
    get: (messageId: string): Promise<ProcessedMessage | null> =>
      ipcRenderer.invoke('messages:get', messageId)
  },
  rules: {
    list: (): Promise<Rule[]> =>
      ipcRenderer.invoke('rules:list'),
    upsert: (rule: Rule): Promise<Rule> =>
      ipcRenderer.invoke('rules:upsert', rule),
    delete: (ruleId: string): Promise<void> =>
      ipcRenderer.invoke('rules:delete', ruleId)
  },
  pipeline: {
    run: (accountId?: string): Promise<{ processed: number; errors: number }> =>
      ipcRenderer.invoke('pipeline:run', accountId)
  }
}

contextBridge.exposeInMainWorld('mailAgent', api)

export type MailAgentAPI = typeof api

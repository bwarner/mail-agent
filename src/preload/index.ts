import { contextBridge, ipcRenderer } from 'electron'
import type { EmailAccount, ProcessedMessage, Rule, ComposeMessage, FolderInfo } from '../shared/types'
import type { PluginInfo } from '../shared/plugin-types'

const api = {
  accounts: {
    list: (): Promise<EmailAccount[]> =>
      ipcRenderer.invoke('accounts:list'),
    add: (account: Omit<EmailAccount, 'account_id'>): Promise<EmailAccount> =>
      ipcRenderer.invoke('accounts:add', account),
    remove: (accountId: string): Promise<void> =>
      ipcRenderer.invoke('accounts:remove', accountId),
    sync: (accountId: string): Promise<{ processed: number; errors: number }> =>
      ipcRenderer.invoke('accounts:sync', accountId),
    folders: (accountId: string): Promise<FolderInfo[]> =>
      ipcRenderer.invoke('accounts:folders', accountId)
  },
  messages: {
    list: (opts: { accountId?: string; folderId?: string; limit?: number; offset?: number }): Promise<ProcessedMessage[]> =>
      ipcRenderer.invoke('messages:list', opts),
    search: (query: string): Promise<ProcessedMessage[]> =>
      ipcRenderer.invoke('messages:search', query),
    get: (messageId: string): Promise<ProcessedMessage | null> =>
      ipcRenderer.invoke('messages:get', messageId),
    thread: (threadId: string): Promise<ProcessedMessage[]> =>
      ipcRenderer.invoke('messages:thread', threadId),
    markRead: (messageIds: string[], read: boolean): Promise<void> =>
      ipcRenderer.invoke('messages:markRead', messageIds, read),
    star: (messageIds: string[], starred: boolean): Promise<void> =>
      ipcRenderer.invoke('messages:star', messageIds, starred),
    archive: (messageIds: string[]): Promise<void> =>
      ipcRenderer.invoke('messages:archive', messageIds),
    trash: (messageIds: string[]): Promise<void> =>
      ipcRenderer.invoke('messages:trash', messageIds),
    move: (messageIds: string[], folderId: string): Promise<void> =>
      ipcRenderer.invoke('messages:move', messageIds, folderId),
    addLabels: (messageIds: string[], labels: string[]): Promise<void> =>
      ipcRenderer.invoke('messages:addLabels', messageIds, labels),
    removeLabels: (messageIds: string[], labels: string[]): Promise<void> =>
      ipcRenderer.invoke('messages:removeLabels', messageIds, labels)
  },
  compose: {
    send: (accountId: string, message: ComposeMessage): Promise<string> =>
      ipcRenderer.invoke('compose:send', accountId, message),
    saveDraft: (accountId: string, message: ComposeMessage): Promise<string> =>
      ipcRenderer.invoke('compose:saveDraft', accountId, message)
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
  },
  plugins: {
    list: (): Promise<PluginInfo[]> =>
      ipcRenderer.invoke('plugins:list'),
    enable: (name: string): Promise<void> =>
      ipcRenderer.invoke('plugins:enable', name),
    disable: (name: string): Promise<void> =>
      ipcRenderer.invoke('plugins:disable', name),
    configure: (name: string, config: Record<string, unknown>): Promise<void> =>
      ipcRenderer.invoke('plugins:configure', name, config),
    reload: (): Promise<void> =>
      ipcRenderer.invoke('plugins:reload')
  }
}

contextBridge.exposeInMainWorld('mailAgent', api)

export type MailAgentAPI = typeof api

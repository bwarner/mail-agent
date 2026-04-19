export type PluginType = 'processor' | 'action' | 'viewer'

export type PluginPermission =
  | 'read_messages'
  | 'read_attachments'
  | 'write_tags'
  | 'write_extracted_data'
  | 'http_outbound'
  | 'storage_read'
  | 'storage_write'
  | 'notifications'

export interface PluginManifest {
  name: string
  version: string
  displayName: string
  description: string
  author: string
  license: string
  type: PluginType
  main: string
  permissions: PluginPermission[]
  config_schema?: Record<string, unknown>
  hooks?: {
    on_message?: boolean
    on_schedule?: string
  }
}

export interface PluginInfo {
  manifest: PluginManifest
  path: string
  enabled: boolean
  config: Record<string, unknown>
  installed_at: string
  error?: string
}

export interface PluginResult {
  tags_added?: string[]
  tags_removed?: string[]
  extracted_data?: Record<string, unknown>
  notifications?: { title: string; body: string }[]
  error?: string
}

// Messages sent from main → Worker
export type PluginWorkerRequest =
  | {
      type: 'init'
      manifest: PluginManifest
      config: Record<string, unknown>
    }
  | {
      type: 'process_message'
      message: PluginReadonlyMessage
      attachments: PluginReadonlyAttachment[]
      request_id: string
    }
  | {
      type: 'shutdown'
    }

// Messages sent from Worker → main
export type PluginWorkerResponse =
  | {
      type: 'init_result'
      success: boolean
      error?: string
    }
  | {
      type: 'process_result'
      request_id: string
      result: PluginResult
    }
  | {
      type: 'storage_request'
      request_id: string
      op: 'get' | 'set' | 'delete' | 'list'
      key?: string
      value?: unknown
      prefix?: string
    }
  | {
      type: 'fetch_request'
      request_id: string
      url: string
      opts?: { method?: string; headers?: Record<string, string>; body?: string }
    }
  | {
      type: 'notify'
      title: string
      body: string
    }
  | {
      type: 'log'
      level: 'info' | 'warn' | 'error'
      message: string
    }

// Read-only message data passed to plugins
export interface PluginReadonlyMessage {
  message_id: string
  account_id: string
  provider: string
  from_address: string
  from_name: string
  to: string[]
  cc: string[]
  subject: string
  body_text: string
  date: string
  headers: Record<string, string>
  labels: string[]
  thread_id: string
  tags: string[]
  extracted_data: Record<string, unknown>
}

export interface PluginReadonlyAttachment {
  attachment_id: string
  filename: string
  mime_type: string
  size_bytes: number
  ocr_text?: string
}

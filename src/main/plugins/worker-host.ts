import { parentPort, workerData } from 'worker_threads'
import type {
  PluginWorkerRequest,
  PluginWorkerResponse,
  PluginReadonlyMessage,
  PluginReadonlyAttachment,
  PluginResult,
  PluginManifest
} from '../../shared/plugin-types'

if (!parentPort) {
  throw new Error('worker-host must be run as a Worker thread')
}

const { pluginPath } = workerData as { pluginPath: string; pluginName: string }

let pluginModule: any = null
let pluginConfig: Record<string, unknown> = {}
let pluginManifest: PluginManifest

const pendingStorage = new Map<string, {
  resolve: (value: unknown) => void
  reject: (err: Error) => void
}>()

const pendingFetch = new Map<string, {
  resolve: (value: { status: number; body: string }) => void
  reject: (err: Error) => void
}>()

// Build the PluginContext API available to plugin code
function buildContext(
  message: PluginReadonlyMessage,
  attachments: PluginReadonlyAttachment[]
) {
  const result: PluginResult = {}

  return {
    message,
    attachments,

    addTag(tag: string) {
      if (!result.tags_added) result.tags_added = []
      result.tags_added.push(tag)
    },

    removeTag(tag: string) {
      if (!result.tags_removed) result.tags_removed = []
      result.tags_removed.push(tag)
    },

    setExtractedData(key: string, value: unknown) {
      if (!result.extracted_data) result.extracted_data = {}
      result.extracted_data[key] = value
    },

    storage: {
      get: (key: string) => storageRequest('get', key),
      set: (key: string, value: unknown) => storageRequest('set', key, value),
      delete: (key: string) => storageRequest('delete', key),
      list: (prefix?: string) => storageRequest('list', undefined, undefined, prefix)
    },

    fetch: (url: string, opts?: RequestInit) => fetchRequest(url, opts),

    notify(title: string, body: string) {
      const msg: PluginWorkerResponse = { type: 'notify', title, body }
      parentPort!.postMessage(msg)
    },

    config: pluginConfig,

    log: {
      info: (msg: string) => log('info', msg),
      warn: (msg: string) => log('warn', msg),
      error: (msg: string) => log('error', msg)
    },

    _getResult: () => result
  }
}

function log(level: 'info' | 'warn' | 'error', message: string) {
  const msg: PluginWorkerResponse = { type: 'log', level, message }
  parentPort!.postMessage(msg)
}

function storageRequest(
  op: 'get' | 'set' | 'delete' | 'list',
  key?: string,
  value?: unknown,
  prefix?: string
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const requestId = `storage_${Date.now()}_${Math.random()}`
    pendingStorage.set(requestId, { resolve, reject })

    const msg: PluginWorkerResponse = {
      type: 'storage_request',
      request_id: requestId,
      op,
      key,
      value,
      prefix
    }
    parentPort!.postMessage(msg)
  })
}

function fetchRequest(
  url: string,
  opts?: RequestInit
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const requestId = `fetch_${Date.now()}_${Math.random()}`
    pendingFetch.set(requestId, { resolve, reject })

    const msg: PluginWorkerResponse = {
      type: 'fetch_request',
      request_id: requestId,
      url,
      opts: opts ? {
        method: opts.method as string,
        headers: opts.headers as Record<string, string>,
        body: opts.body as string
      } : undefined
    }
    parentPort!.postMessage(msg)
  })
}

parentPort.on('message', async (msg: PluginWorkerRequest | any) => {
  // Handle responses from main thread
  if (msg.type === 'storage_response') {
    const pending = pendingStorage.get(msg.request_id)
    if (pending) {
      pendingStorage.delete(msg.request_id)
      if (msg.value?.error) pending.reject(new Error(msg.value.error))
      else pending.resolve(msg.value)
    }
    return
  }

  if (msg.type === 'fetch_response') {
    const pending = pendingFetch.get(msg.request_id)
    if (pending) {
      pendingFetch.delete(msg.request_id)
      if (msg.error) pending.reject(new Error(msg.error))
      else pending.resolve({ status: msg.status, body: msg.body })
    }
    return
  }

  // Handle requests from main thread
  switch (msg.type) {
    case 'init': {
      try {
        pluginManifest = msg.manifest
        pluginConfig = msg.config
        pluginModule = await import(pluginPath)

        if (typeof pluginModule.init === 'function') {
          await pluginModule.init(pluginConfig)
        }

        const response: PluginWorkerResponse = {
          type: 'init_result',
          success: true
        }
        parentPort!.postMessage(response)
      } catch (err) {
        const response: PluginWorkerResponse = {
          type: 'init_result',
          success: false,
          error: err instanceof Error ? err.message : String(err)
        }
        parentPort!.postMessage(response)
      }
      break
    }

    case 'process_message': {
      try {
        if (typeof pluginModule?.onMessage !== 'function') {
          const response: PluginWorkerResponse = {
            type: 'process_result',
            request_id: msg.request_id,
            result: {}
          }
          parentPort!.postMessage(response)
          return
        }

        const ctx = buildContext(msg.message, msg.attachments)
        await pluginModule.onMessage(ctx)

        const response: PluginWorkerResponse = {
          type: 'process_result',
          request_id: msg.request_id,
          result: (ctx as any)._getResult()
        }
        parentPort!.postMessage(response)
      } catch (err) {
        const response: PluginWorkerResponse = {
          type: 'process_result',
          request_id: msg.request_id,
          result: { error: err instanceof Error ? err.message : String(err) }
        }
        parentPort!.postMessage(response)
      }
      break
    }

    case 'shutdown': {
      if (typeof pluginModule?.shutdown === 'function') {
        await pluginModule.shutdown()
      }
      process.exit(0)
      break
    }
  }
})

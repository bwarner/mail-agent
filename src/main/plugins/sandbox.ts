import { Worker } from 'worker_threads'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type {
  PluginInfo,
  PluginResult,
  PluginReadonlyMessage,
  PluginReadonlyAttachment,
  PluginWorkerRequest,
  PluginWorkerResponse
} from '../../shared/plugin-types'
import { db } from '../database'

const PLUGIN_TIMEOUT_MS = 30_000

export class PluginSandbox {
  private worker: Worker | null = null
  private pending = new Map<string, {
    resolve: (result: PluginResult) => void
    reject: (err: Error) => void
    timer: ReturnType<typeof setTimeout>
  }>()

  constructor(private plugin: PluginInfo) {}

  async start(): Promise<void> {
    if (this.worker) return

    const workerScript = join(__dirname, 'worker-host.js')

    this.worker = new Worker(workerScript, {
      workerData: {
        pluginPath: join(this.plugin.path, this.plugin.manifest.main),
        pluginName: this.plugin.manifest.name
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 32
      }
    })

    this.worker.on('message', (msg: PluginWorkerResponse) =>
      this.handleMessage(msg)
    )

    this.worker.on('error', (err) => {
      console.error(`Plugin ${this.plugin.manifest.name} worker error:`, err)
      this.rejectAll(err)
    })

    this.worker.on('exit', (code) => {
      if (code !== 0) {
        console.error(`Plugin ${this.plugin.manifest.name} exited with code ${code}`)
      }
      this.worker = null
      this.rejectAll(new Error(`Worker exited with code ${code}`))
    })

    const initMsg: PluginWorkerRequest = {
      type: 'init',
      manifest: this.plugin.manifest,
      config: this.plugin.config
    }
    this.worker.postMessage(initMsg)
  }

  async processMessage(
    message: PluginReadonlyMessage,
    attachments: PluginReadonlyAttachment[]
  ): Promise<PluginResult> {
    if (!this.worker) throw new Error('Plugin not started')

    if (!this.plugin.manifest.permissions.includes('read_messages')) {
      return {}
    }

    const filteredAttachments = this.plugin.manifest.permissions.includes('read_attachments')
      ? attachments
      : []

    const requestId = randomUUID()

    return new Promise<PluginResult>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId)
        reject(new Error(`Plugin ${this.plugin.manifest.name} timed out`))
      }, PLUGIN_TIMEOUT_MS)

      this.pending.set(requestId, { resolve, reject, timer })

      const msg: PluginWorkerRequest = {
        type: 'process_message',
        message,
        attachments: filteredAttachments,
        request_id: requestId
      }
      this.worker!.postMessage(msg)
    })
  }

  async stop(): Promise<void> {
    if (!this.worker) return
    this.worker.postMessage({ type: 'shutdown' } as PluginWorkerRequest)
    this.rejectAll(new Error('Plugin shutting down'))
    await this.worker.terminate()
    this.worker = null
  }

  private async handleMessage(msg: PluginWorkerResponse): Promise<void> {
    switch (msg.type) {
      case 'process_result': {
        const pending = this.pending.get(msg.request_id)
        if (pending) {
          clearTimeout(pending.timer)
          this.pending.delete(msg.request_id)

          const filtered = this.filterResult(msg.result)
          pending.resolve(filtered)
        }
        break
      }

      case 'storage_request': {
        await this.handleStorageRequest(msg)
        break
      }

      case 'fetch_request': {
        await this.handleFetchRequest(msg)
        break
      }

      case 'notify': {
        if (this.plugin.manifest.permissions.includes('notifications')) {
          const { Notification } = await import('electron')
          new Notification({ title: msg.title, body: msg.body }).show()
        }
        break
      }

      case 'log': {
        const prefix = `[plugin:${this.plugin.manifest.name}]`
        switch (msg.level) {
          case 'info': console.log(prefix, msg.message); break
          case 'warn': console.warn(prefix, msg.message); break
          case 'error': console.error(prefix, msg.message); break
        }
        break
      }
    }
  }

  private filterResult(result: PluginResult): PluginResult {
    const perms = new Set(this.plugin.manifest.permissions)
    const filtered: PluginResult = {}

    if (perms.has('write_tags')) {
      filtered.tags_added = result.tags_added
      filtered.tags_removed = result.tags_removed
    }
    if (perms.has('write_extracted_data')) {
      filtered.extracted_data = result.extracted_data
    }
    if (result.error) {
      filtered.error = result.error
    }

    return filtered
  }

  private async handleStorageRequest(msg: Extract<PluginWorkerResponse, { type: 'storage_request' }>): Promise<void> {
    const perms = new Set(this.plugin.manifest.permissions)
    const ns = `plugin:${this.plugin.manifest.name}`

    let responseValue: unknown = null

    try {
      switch (msg.op) {
        case 'get':
          if (!perms.has('storage_read')) throw new Error('No storage_read permission')
          responseValue = await db.getPluginStorage(ns, msg.key!)
          break
        case 'set':
          if (!perms.has('storage_write')) throw new Error('No storage_write permission')
          await db.setPluginStorage(ns, msg.key!, msg.value)
          break
        case 'delete':
          if (!perms.has('storage_write')) throw new Error('No storage_write permission')
          await db.deletePluginStorage(ns, msg.key!)
          break
        case 'list':
          if (!perms.has('storage_read')) throw new Error('No storage_read permission')
          responseValue = await db.listPluginStorage(ns, msg.prefix)
          break
      }
    } catch (err) {
      responseValue = { error: err instanceof Error ? err.message : String(err) }
    }

    this.worker?.postMessage({
      type: 'storage_response',
      request_id: msg.request_id,
      value: responseValue
    })
  }

  private async handleFetchRequest(msg: Extract<PluginWorkerResponse, { type: 'fetch_request' }>): Promise<void> {
    if (!this.plugin.manifest.permissions.includes('http_outbound')) {
      this.worker?.postMessage({
        type: 'fetch_response',
        request_id: msg.request_id,
        error: 'No http_outbound permission'
      })
      return
    }

    try {
      const response = await fetch(msg.url, msg.opts)
      const body = await response.text()
      this.worker?.postMessage({
        type: 'fetch_response',
        request_id: msg.request_id,
        status: response.status,
        body
      })
    } catch (err) {
      this.worker?.postMessage({
        type: 'fetch_response',
        request_id: msg.request_id,
        error: err instanceof Error ? err.message : String(err)
      })
    }
  }

  private rejectAll(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer)
      pending.reject(err)
    }
    this.pending.clear()
  }
}

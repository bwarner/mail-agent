import { discoverPlugins } from './loader'
import { PluginSandbox } from './sandbox'
import { db } from '../database'
import type {
  PluginInfo,
  PluginResult,
  PluginReadonlyMessage,
  PluginReadonlyAttachment
} from '../../shared/plugin-types'
import type { ProcessedMessage } from '../../shared/types'

export class PluginManager {
  private sandboxes = new Map<string, PluginSandbox>()
  private plugins = new Map<string, PluginInfo>()

  async init(): Promise<void> {
    const discovered = await discoverPlugins()

    for (const plugin of discovered) {
      this.plugins.set(plugin.manifest.name, plugin)

      const stored = await db.getPlugin(plugin.manifest.name)
      if (stored) {
        plugin.enabled = stored.enabled
        plugin.config = stored.config
      }

      await db.savePlugin(plugin)

      if (plugin.enabled && !plugin.error) {
        await this.startPlugin(plugin.manifest.name)
      }
    }
  }

  async startPlugin(name: string): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) throw new Error(`Plugin "${name}" not found`)
    if (plugin.error) throw new Error(`Plugin "${name}" has errors: ${plugin.error}`)

    if (this.sandboxes.has(name)) return

    const sandbox = new PluginSandbox(plugin)
    await sandbox.start()
    this.sandboxes.set(name, sandbox)

    plugin.enabled = true
    await db.savePlugin(plugin)
  }

  async stopPlugin(name: string): Promise<void> {
    const sandbox = this.sandboxes.get(name)
    if (sandbox) {
      await sandbox.stop()
      this.sandboxes.delete(name)
    }

    const plugin = this.plugins.get(name)
    if (plugin) {
      plugin.enabled = false
      await db.savePlugin(plugin)
    }
  }

  async configurePlugin(name: string, config: Record<string, unknown>): Promise<void> {
    const plugin = this.plugins.get(name)
    if (!plugin) throw new Error(`Plugin "${name}" not found`)

    const wasRunning = this.sandboxes.has(name)
    if (wasRunning) await this.stopPlugin(name)

    plugin.config = config
    await db.savePlugin(plugin)

    if (wasRunning) await this.startPlugin(name)
  }

  async processMessage(message: ProcessedMessage): Promise<PluginResult[]> {
    const results: PluginResult[] = []

    const readonlyMsg = toReadonlyMessage(message)
    const readonlyAttachments = toReadonlyAttachments(message)

    for (const [name, sandbox] of this.sandboxes) {
      const plugin = this.plugins.get(name)
      if (!plugin || plugin.manifest.type !== 'processor') continue
      if (!plugin.manifest.hooks?.on_message) continue

      try {
        const result = await sandbox.processMessage(readonlyMsg, readonlyAttachments)
        results.push(result)
      } catch (err) {
        console.error(`Plugin ${name} processing error:`, err)
        results.push({
          error: err instanceof Error ? err.message : String(err)
        })
      }
    }

    return results
  }

  async dispatchToAction(
    agentName: string,
    message: ProcessedMessage
  ): Promise<PluginResult | null> {
    const sandbox = this.sandboxes.get(agentName)
    if (!sandbox) return null

    const plugin = this.plugins.get(agentName)
    if (!plugin || plugin.manifest.type !== 'action') return null

    const readonlyMsg = toReadonlyMessage(message)
    const readonlyAttachments = toReadonlyAttachments(message)

    return sandbox.processMessage(readonlyMsg, readonlyAttachments)
  }

  listPlugins(): PluginInfo[] {
    return [...this.plugins.values()]
  }

  getPlugin(name: string): PluginInfo | undefined {
    return this.plugins.get(name)
  }

  async reload(): Promise<void> {
    for (const [name] of this.sandboxes) {
      await this.stopPlugin(name)
    }
    this.plugins.clear()
    await this.init()
  }

  async shutdown(): Promise<void> {
    for (const [name] of this.sandboxes) {
      await this.stopPlugin(name)
    }
  }
}

function toReadonlyMessage(msg: ProcessedMessage): PluginReadonlyMessage {
  return {
    message_id: msg.message_id,
    account_id: msg.account_id,
    provider: msg.provider,
    from_address: msg.from_address,
    from_name: msg.from_name,
    to: msg.to,
    cc: msg.cc,
    subject: msg.subject,
    body_text: msg.body_text,
    date: msg.date,
    headers: msg.headers,
    labels: msg.labels,
    thread_id: msg.thread_id,
    tags: msg.tags,
    extracted_data: msg.extracted_data
  }
}

function toReadonlyAttachments(msg: ProcessedMessage): PluginReadonlyAttachment[] {
  return msg.attachments.map((a) => ({
    attachment_id: a.attachment_id,
    filename: a.filename,
    mime_type: a.mime_type,
    size_bytes: a.size_bytes,
    ocr_text: a.ocr_text
  }))
}

export const pluginManager = new PluginManager()

import { app } from 'electron'
import { join } from 'path'
import { readdir, readFile, access } from 'fs/promises'
import type { PluginManifest, PluginInfo, PluginPermission } from '../../shared/plugin-types'

const VALID_PERMISSIONS: Set<PluginPermission> = new Set([
  'read_messages', 'read_attachments', 'write_tags', 'write_extracted_data',
  'http_outbound', 'storage_read', 'storage_write', 'notifications'
])

const FORBIDDEN_PERMISSIONS = new Set(['send_email', 'modify_rules', 'access_credentials'])

export function getPluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}

export async function discoverPlugins(): Promise<PluginInfo[]> {
  const pluginsDir = getPluginsDir()
  const plugins: PluginInfo[] = []

  let entries: string[]
  try {
    entries = await readdir(pluginsDir)
  } catch {
    return []
  }

  for (const entry of entries) {
    const pluginPath = join(pluginsDir, entry)
    const manifestPath = join(pluginPath, 'plugin.json')

    try {
      await access(manifestPath)
      const raw = await readFile(manifestPath, 'utf-8')
      const manifest = JSON.parse(raw) as PluginManifest

      const validationError = validateManifest(manifest)
      if (validationError) {
        plugins.push({
          manifest,
          path: pluginPath,
          enabled: false,
          config: {},
          installed_at: new Date().toISOString(),
          error: validationError
        })
        continue
      }

      const mainPath = join(pluginPath, manifest.main)
      await access(mainPath)

      plugins.push({
        manifest,
        path: pluginPath,
        enabled: false,
        config: {},
        installed_at: new Date().toISOString()
      })
    } catch (err) {
      plugins.push({
        manifest: {
          name: entry,
          version: '0.0.0',
          displayName: entry,
          description: '',
          author: '',
          license: '',
          type: 'processor',
          main: 'index.js',
          permissions: []
        },
        path: pluginPath,
        enabled: false,
        config: {},
        installed_at: new Date().toISOString(),
        error: `Failed to load: ${err instanceof Error ? err.message : String(err)}`
      })
    }
  }

  return plugins
}

function validateManifest(manifest: PluginManifest): string | null {
  if (!manifest.name || typeof manifest.name !== 'string') {
    return 'Missing or invalid "name"'
  }
  if (!/^[a-z0-9-]+$/.test(manifest.name)) {
    return '"name" must be lowercase alphanumeric with hyphens only'
  }
  if (!manifest.version) return 'Missing "version"'
  if (!manifest.main) return 'Missing "main"'
  if (!['processor', 'action', 'viewer'].includes(manifest.type)) {
    return `Invalid type "${manifest.type}"`
  }
  if (!Array.isArray(manifest.permissions)) {
    return '"permissions" must be an array'
  }

  for (const perm of manifest.permissions) {
    if (FORBIDDEN_PERMISSIONS.has(perm)) {
      return `Forbidden permission: "${perm}"`
    }
    if (!VALID_PERMISSIONS.has(perm)) {
      return `Unknown permission: "${perm}"`
    }
  }

  return null
}

import { safeStorage } from 'electron'
import { db } from '../database'

export const vault = {
  async store(key: string, value: string): Promise<void> {
    let encrypted: string
    if (safeStorage.isEncryptionAvailable()) {
      encrypted = safeStorage.encryptString(value).toString('base64')
    } else {
      encrypted = Buffer.from(value).toString('base64')
    }
    await db.vaultSet(key, encrypted)
  },

  async load(key: string): Promise<string | null> {
    const encrypted = await db.vaultGet(key)
    if (!encrypted) return null

    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
    }
    return Buffer.from(encrypted, 'base64').toString('utf-8')
  },

  async storeJSON<T>(key: string, value: T): Promise<void> {
    await vault.store(key, JSON.stringify(value))
  },

  async loadJSON<T>(key: string): Promise<T | null> {
    const raw = await vault.load(key)
    if (!raw) return null
    return JSON.parse(raw) as T
  },

  async remove(key: string): Promise<void> {
    await db.vaultDelete(key)
  },

  async has(key: string): Promise<boolean> {
    return (await db.vaultGet(key)) !== null
  },

  isEncryptionAvailable(): boolean {
    return safeStorage.isEncryptionAvailable()
  }
}

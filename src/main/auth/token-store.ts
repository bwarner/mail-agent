import { safeStorage } from 'electron'
import { db } from '../database'

const TOKEN_PREFIX = 'oauth_token:'

export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
  scope: string
}

export async function storeTokens(accountId: string, tokens: OAuthTokens): Promise<void> {
  const json = JSON.stringify(tokens)
  let encrypted: string

  if (safeStorage.isEncryptionAvailable()) {
    encrypted = safeStorage.encryptString(json).toString('base64')
  } else {
    encrypted = Buffer.from(json).toString('base64')
  }

  await db.setPluginStorage(TOKEN_PREFIX, accountId, encrypted)
}

export async function loadTokens(accountId: string): Promise<OAuthTokens | null> {
  const encrypted = await db.getPluginStorage(TOKEN_PREFIX, accountId) as string | null
  if (!encrypted) return null

  let json: string
  if (safeStorage.isEncryptionAvailable()) {
    json = safeStorage.decryptString(Buffer.from(encrypted, 'base64'))
  } else {
    json = Buffer.from(encrypted, 'base64').toString('utf-8')
  }

  return JSON.parse(json) as OAuthTokens
}

export async function deleteTokens(accountId: string): Promise<void> {
  await db.deletePluginStorage(TOKEN_PREFIX, accountId)
}

export function isTokenExpired(tokens: OAuthTokens): boolean {
  return Date.now() >= tokens.expiry_date - 60_000
}

import { vault } from './vault'

const OAUTH_PREFIX = 'oauth:'


export interface OAuthTokens {
  access_token: string
  refresh_token: string
  expiry_date: number
  scope: string
}

export async function storeTokens(accountId: string, tokens: OAuthTokens): Promise<void> {
  await vault.storeJSON(`${OAUTH_PREFIX}${accountId}`, tokens)
}

export async function loadTokens(accountId: string): Promise<OAuthTokens | null> {
  return vault.loadJSON<OAuthTokens>(`${OAUTH_PREFIX}${accountId}`)
}

export async function deleteTokens(accountId: string): Promise<void> {
  await vault.remove(`${OAUTH_PREFIX}${accountId}`)
}

export function isTokenExpired(tokens: OAuthTokens): boolean {
  return Date.now() >= tokens.expiry_date - 60_000
}

export async function storeLLMApiKey(providerId: string, apiKey: string): Promise<void> {
  await vault.store(`llm_key:${providerId}`, apiKey)
}

export async function loadLLMApiKey(providerId: string): Promise<string | null> {
  return vault.load(`llm_key:${providerId}`)
}

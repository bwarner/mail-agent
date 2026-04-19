import { shell } from 'electron'
import { randomUUID } from 'crypto'
import { startOAuthServer } from './oauth-server'
import { storeTokens, loadTokens, isTokenExpired, type OAuthTokens } from './token-store'

const SCOPES = ['Mail.ReadWrite', 'Mail.Send', 'User.Read', 'offline_access']
const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0'

export interface OutlookAuthConfig {
  clientId: string
  clientSecret?: string
}

let authConfig: OutlookAuthConfig | null = null

export function configureOutlookAuth(config: OutlookAuthConfig): void {
  authConfig = config
}

export async function startOutlookOAuth(): Promise<{
  email: string
  displayName: string
  accountId: string
}> {
  if (!authConfig) throw new Error('Outlook OAuth not configured — set client ID in Settings')

  const server = await startOAuthServer()
  const redirectUri = `http://127.0.0.1:${server.port}`
  const state = randomUUID()

  const params = new URLSearchParams({
    client_id: authConfig.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    state,
    response_mode: 'query'
  })

  shell.openExternal(`${AUTH_ENDPOINT}/authorize?${params}`)

  try {
    const { code, state: returnedState } = await server.waitForCallback()

    if (returnedState !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack')
    }

    const tokenParams = new URLSearchParams({
      client_id: authConfig.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      scope: SCOPES.join(' ')
    })
    if (authConfig.clientSecret) {
      tokenParams.set('client_secret', authConfig.clientSecret)
    }

    const tokenResponse = await fetch(`${AUTH_ENDPOINT}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: tokenParams.toString()
    })

    if (!tokenResponse.ok) {
      const errBody = await tokenResponse.text()
      throw new Error(`Token exchange failed: ${errBody}`)
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string
      refresh_token: string
      expires_in: number
    }

    const meResponse = await fetch('https://graph.microsoft.com/v1.0/me', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    })
    const me = await meResponse.json() as {
      mail?: string
      userPrincipalName: string
      displayName: string
    }

    const email = me.mail ?? me.userPrincipalName
    const displayName = me.displayName ?? email
    const accountId = `outlook:${email}`

    const oauthTokens: OAuthTokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
      expiry_date: Date.now() + tokenData.expires_in * 1000,
      scope: SCOPES.join(' ')
    }

    await storeTokens(accountId, oauthTokens)

    return { email, displayName, accountId }
  } finally {
    server.close()
  }
}

export async function getOutlookToken(accountId: string): Promise<string> {
  if (!authConfig) throw new Error('Outlook OAuth not configured')

  const tokens = await loadTokens(accountId)
  if (!tokens) throw new Error(`No tokens found for ${accountId}`)

  if (!isTokenExpired(tokens)) return tokens.access_token

  const params = new URLSearchParams({
    client_id: authConfig.clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    scope: SCOPES.join(' ')
  })
  if (authConfig.clientSecret) {
    params.set('client_secret', authConfig.clientSecret)
  }

  const response = await fetch(`${AUTH_ENDPOINT}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  })

  if (!response.ok) throw new Error('Token refresh failed')

  const data = await response.json() as {
    access_token: string
    refresh_token?: string
    expires_in: number
  }

  const refreshed: OAuthTokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token ?? tokens.refresh_token,
    expiry_date: Date.now() + data.expires_in * 1000,
    scope: tokens.scope
  }

  await storeTokens(accountId, refreshed)
  return data.access_token
}

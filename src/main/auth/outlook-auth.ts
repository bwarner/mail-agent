import { shell } from 'electron'
import { randomUUID } from 'crypto'
import { startOAuthServer } from './oauth-server'
import { storeTokens, loadTokens, isTokenExpired, type OAuthTokens } from './token-store'
import { generatePKCE } from './pkce'
import { OAUTH_CONFIG, isOAuthConfigured } from './oauth-config'

const AUTH_ENDPOINT = 'https://login.microsoftonline.com/common/oauth2/v2.0'

export async function startOutlookOAuth(): Promise<{
  email: string
  displayName: string
  accountId: string
}> {
  if (!isOAuthConfigured('outlook')) {
    throw new Error('Outlook OAuth not configured. Set AZURE_CLIENT_ID in oauth-config.ts before distributing.')
  }

  const config = OAUTH_CONFIG.outlook
  const pkce = generatePKCE()
  const server = await startOAuthServer()
  const redirectUri = `http://127.0.0.1:${server.port}`
  const state = randomUUID()

  const params = new URLSearchParams({
    client_id: config.clientId,
    response_type: 'code',
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state,
    response_mode: 'query',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256'
  })

  shell.openExternal(`${AUTH_ENDPOINT}/authorize?${params}`)

  try {
    const { code, state: returnedState } = await server.waitForCallback()

    if (returnedState !== state) {
      throw new Error('OAuth state mismatch — possible CSRF attack')
    }

    // PKCE token exchange — no client_secret needed for public clients
    const tokenParams = new URLSearchParams({
      client_id: config.clientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      code_verifier: pkce.verifier
    })

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
      scope: config.scopes.join(' ')
    }

    await storeTokens(accountId, oauthTokens)
    return { email, displayName, accountId }
  } finally {
    server.close()
  }
}

export async function getOutlookToken(accountId: string): Promise<string> {
  const config = OAUTH_CONFIG.outlook
  const tokens = await loadTokens(accountId)
  if (!tokens) throw new Error(`No tokens found for ${accountId}`)

  if (!isTokenExpired(tokens)) return tokens.access_token

  // Refresh with public client — no client_secret
  const params = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    scope: config.scopes.join(' ')
  })

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

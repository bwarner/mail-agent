import { shell } from 'electron'
import { google } from 'googleapis'
import { startOAuthServer } from './oauth-server'
import { storeTokens, loadTokens, isTokenExpired, type OAuthTokens } from './token-store'
import { generatePKCE } from './pkce'
import { OAUTH_CONFIG, isOAuthConfigured } from './oauth-config'

export async function startGmailOAuth(): Promise<{
  email: string
  displayName: string
  accountId: string
}> {
  if (!isOAuthConfigured('gmail')) {
    throw new Error('Gmail OAuth not configured. Set GOOGLE_CLIENT_ID in oauth-config.ts before distributing.')
  }

  const config = OAUTH_CONFIG.gmail
  const pkce = generatePKCE()
  const server = await startOAuthServer()
  const redirectUri = `http://127.0.0.1:${server.port}`

  const oauth2 = new google.auth.OAuth2(config.clientId, '', redirectUri)

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: config.scopes,
    prompt: 'consent',
    code_challenge: pkce.challenge,
    code_challenge_method: pkce.method
  } as any)

  shell.openExternal(authUrl)

  try {
    const { code } = await server.waitForCallback()

    const { tokens } = await oauth2.getToken({
      code,
      codeVerifier: pkce.verifier
    } as any)

    oauth2.setCredentials(tokens)
    const people = google.people({ version: 'v1', auth: oauth2 })
    const me = await people.people.get({
      resourceName: 'people/me',
      personFields: 'emailAddresses,names'
    })

    const email = me.data.emailAddresses?.[0]?.value ?? 'unknown'
    const displayName = me.data.names?.[0]?.displayName ?? email
    const accountId = `gmail:${email}`

    const oauthTokens: OAuthTokens = {
      access_token: tokens.access_token!,
      refresh_token: tokens.refresh_token!,
      expiry_date: tokens.expiry_date ?? Date.now() + 3600_000,
      scope: config.scopes.join(' ')
    }

    await storeTokens(accountId, oauthTokens)
    return { email, displayName, accountId }
  } finally {
    server.close()
  }
}

export async function getGmailClient(accountId: string) {
  const config = OAUTH_CONFIG.gmail
  const tokens = await loadTokens(accountId)
  if (!tokens) throw new Error(`No tokens found for ${accountId}`)

  const oauth2 = new google.auth.OAuth2(config.clientId)

  oauth2.setCredentials({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    expiry_date: tokens.expiry_date
  })

  if (isTokenExpired(tokens)) {
    const { credentials } = await oauth2.refreshAccessToken()
    const refreshed: OAuthTokens = {
      access_token: credentials.access_token!,
      refresh_token: credentials.refresh_token ?? tokens.refresh_token,
      expiry_date: credentials.expiry_date ?? Date.now() + 3600_000,
      scope: tokens.scope
    }
    await storeTokens(accountId, refreshed)
    oauth2.setCredentials(credentials)
  }

  return google.gmail({ version: 'v1', auth: oauth2 })
}

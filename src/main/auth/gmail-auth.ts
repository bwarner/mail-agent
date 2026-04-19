import { shell } from 'electron'
import { google } from 'googleapis'
import { startOAuthServer } from './oauth-server'
import { storeTokens, loadTokens, isTokenExpired, type OAuthTokens } from './token-store'

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/gmail.compose',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email'
]

export interface GmailAuthConfig {
  clientId: string
  clientSecret: string
}

let authConfig: GmailAuthConfig | null = null

export function configureGmailAuth(config: GmailAuthConfig): void {
  authConfig = config
}

export async function startGmailOAuth(): Promise<{
  email: string
  displayName: string
  accountId: string
}> {
  if (!authConfig) throw new Error('Gmail OAuth not configured — set client ID and secret in Settings')

  const server = await startOAuthServer()
  const redirectUri = `http://127.0.0.1:${server.port}`

  const oauth2 = new google.auth.OAuth2(
    authConfig.clientId,
    authConfig.clientSecret,
    redirectUri
  )

  const authUrl = oauth2.generateAuthUrl({
    access_type: 'offline',
    scope: SCOPES,
    prompt: 'consent'
  })

  shell.openExternal(authUrl)

  try {
    const { code } = await server.waitForCallback()
    const { tokens } = await oauth2.getToken(code)

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
      scope: SCOPES.join(' ')
    }

    await storeTokens(accountId, oauthTokens)

    return { email, displayName, accountId }
  } finally {
    server.close()
  }
}

export async function getGmailClient(accountId: string) {
  if (!authConfig) throw new Error('Gmail OAuth not configured')

  const tokens = await loadTokens(accountId)
  if (!tokens) throw new Error(`No tokens found for ${accountId}`)

  const oauth2 = new google.auth.OAuth2(
    authConfig.clientId,
    authConfig.clientSecret
  )

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

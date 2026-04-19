// Developer-configured OAuth client IDs shipped with the app.
// These are PUBLIC identifiers — not secrets. Safe to embed in source.
// Replace these with your own OAuth app registrations before distributing.

export const OAUTH_CONFIG = {
  gmail: {
    clientId: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
    scopes: [
      'https://www.googleapis.com/auth/gmail.modify',
      'https://www.googleapis.com/auth/gmail.compose',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/userinfo.email'
    ]
  },
  outlook: {
    clientId: 'YOUR_AZURE_CLIENT_ID',
    scopes: ['Mail.ReadWrite', 'Mail.Send', 'User.Read', 'offline_access']
  }
} as const

export function isOAuthConfigured(provider: 'gmail' | 'outlook'): boolean {
  const config = OAUTH_CONFIG[provider]
  return !config.clientId.startsWith('YOUR_')
}

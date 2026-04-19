import { randomBytes, createHash } from 'crypto'

export interface PKCEChallenge {
  verifier: string
  challenge: string
  method: 'S256'
}

export function generatePKCE(): PKCEChallenge {
  const verifier = randomBytes(32)
    .toString('base64url')
    .replace(/[^a-zA-Z0-9-._~]/g, '')
    .slice(0, 128)

  const challenge = createHash('sha256')
    .update(verifier)
    .digest('base64url')

  return { verifier, challenge, method: 'S256' }
}

import type { NormalizedMessage, EmailAccount } from '../../shared/types'

export interface ConnectorResult {
  messages: NormalizedMessage[]
  newCursor: string | null
}

export interface EmailConnector {
  readonly provider: EmailAccount['provider']

  fetchMessages(account: EmailAccount): Promise<ConnectorResult>

  testConnection(account: EmailAccount): Promise<boolean>
}

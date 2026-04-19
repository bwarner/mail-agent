import type { EmailConnector } from './base'
import type { Provider } from '../../shared/types'
import { GmailConnector } from './gmail'
import { OutlookConnector } from './outlook'
import { ImapConnector } from './imap'

const connectors: Record<Provider, EmailConnector> = {
  gmail: new GmailConnector(),
  outlook: new OutlookConnector(),
  imap: new ImapConnector()
}

export function getConnector(provider: Provider): EmailConnector {
  return connectors[provider]
}

export type { EmailConnector, ConnectorResult } from './base'

import type { EmailConnector } from './base'
import type { Provider } from '../../shared/types'
import { GmailConnector } from './gmail'
import { OutlookConnector } from './outlook'

const connectors: Record<Provider, EmailConnector> = {
  gmail: new GmailConnector(),
  outlook: new OutlookConnector()
}

export function getConnector(provider: Provider): EmailConnector {
  return connectors[provider]
}

export type { EmailConnector, ConnectorResult } from './base'

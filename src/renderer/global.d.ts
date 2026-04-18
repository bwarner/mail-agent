import type { MailAgentAPI } from '../preload/index'

declare global {
  interface Window {
    mailAgent: MailAgentAPI
  }
}

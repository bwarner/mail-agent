import { useState, useEffect, useCallback } from 'react'
import type { ProcessedMessage } from '../../shared/types'

export function useMessages(accountId?: string) {
  const [messages, setMessages] = useState<ProcessedMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await window.mailAgent.messages.list({
        accountId,
        limit: 100,
        offset: 0
      })
      setMessages(Array.isArray(result) ? result : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load messages')
    } finally {
      setLoading(false)
    }
  }, [accountId])

  const search = useCallback(async (query: string, mode: 'text' | 'semantic' = 'text') => {
    if (!query.trim()) {
      return refresh()
    }
    setLoading(true)
    setError(null)
    try {
      const result = mode === 'semantic'
        ? await window.mailAgent.messages.semanticSearch(query)
        : await window.mailAgent.messages.search(query)
      setMessages(Array.isArray(result) ? result : [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setLoading(false)
    }
  }, [refresh])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { messages, loading, error, refresh, search }
}

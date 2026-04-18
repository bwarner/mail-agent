import { useState, useEffect, useCallback } from 'react'
import type { EmailAccount } from '../../shared/types'

export function useAccounts() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await window.mailAgent.accounts.list()
      setAccounts(result)
    } catch {
      setAccounts([])
    } finally {
      setLoading(false)
    }
  }, [])

  const sync = useCallback(async (accountId: string) => {
    return window.mailAgent.accounts.sync(accountId)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  return { accounts, loading, refresh, sync }
}

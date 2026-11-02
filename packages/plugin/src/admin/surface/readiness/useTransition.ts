'use client'
import { useRef, useState } from 'react'
import type { ApiResult } from '../../api.js'
import type { TestDocApi } from '../contracts.js'
import { API_MESSAGES } from '../../copy/common.js'

/** The ref closes the gap before React renders the disabled button. */
export function useTransition(test: TestDocApi, onSuccess?: () => void) {
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(request: () => Promise<ApiResult<unknown>>) {
    if (inFlight.current || test.hasUnsaved || test.saving === 'saving') return
    inFlight.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await request()
      if (result.ok) {
        await test.reload()
        onSuccess?.()
        // Keep the successful action locked until the reloaded document replaces this view.
        return
      }
      setError(result.message)
    } catch { setError(API_MESSAGES.network) }
    inFlight.current = false
    setBusy(false)
  }
  return { busy, error, run }
}

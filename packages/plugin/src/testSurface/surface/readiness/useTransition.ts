'use client'
import { useRef, useState } from 'react'
import type { ApiResult } from '../../api.js'
import type { TestDocApi } from '../contracts.js'
import { unpublishedPlacementsCopy } from '../../copy/readiness.js'
import { API_MESSAGES } from '../../copy/common.js'

/** The ref closes the gap before React renders the disabled button. */
export function useTransition(test: TestDocApi, onSuccess?: () => void) {
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(request: () => Promise<ApiResult<unknown>>, { reloadOnSuccess = true } = {}) {
    if (inFlight.current || test.hasUnsaved || test.saving === 'saving') return
    inFlight.current = true
    setBusy(true)
    setError(null)
    let refused = false
    try {
      const result = await request()
      if (result.ok) {
        test.acceptTransition?.(result.data)
        if (reloadOnSuccess) {
          await test.reload()
          onSuccess?.()
          // Keep the successful action locked until the reloaded document replaces this view.
          return
        }
      } else {
        refused = true
        setError(result.message)
      }
    } catch {
      refused = true
      setError(API_MESSAGES.network)
    }
    setBusy(false)
    try {
      if (refused) {
        setChecking(true)
        await test.refreshPreflight(true)
      }
    } finally { inFlight.current = false; setChecking(false) }
  }
  return { busy, checking, error, run, clearError: () => setError(null) }
}

/** The same refusal can become a readiness blocker after the refresh. */
export function transitionAlert(error: string | null, test: TestDocApi): string | null {
  const sentences = test.preflight?.checks.filter(check => !check.ok && check.code === 'placement-unpublished').flatMap(check => unpublishedPlacementsCopy(check.detail).split('\n')) ?? []
  return error && !error.split('\n').every(sentence => sentences.includes(sentence)) ? error : null
}

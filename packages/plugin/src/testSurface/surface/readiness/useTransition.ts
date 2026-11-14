'use client'
import { useEffect, useRef, useState } from 'react'
import type { ApiResult } from '../../api.js'
import type { TestDocApi } from '../contracts.js'
import { blockingSteps, pageReadinessContext } from './readiness.model.js'
import type { SurfaceProps } from '../contracts.js'
import type { ActionId } from '../../actions/actions.model.js'
import { API_MESSAGES } from '../../copy/common.js'

/** The ref closes the gap before React renders the disabled button. */
export function useTransition(test: TestDocApi, onSuccess?: () => void, surface?: SurfaceProps) {
  const inFlight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const refusal = useRef<{ kind: ActionId | 'restart'; status: string | undefined; phase: 'rereading' | 'waiting'; answer: TestDocApi['preflight'] } | null>(null)
  const answer = test.preflightRead?.answer ?? test.preflight
  const latestAnswer = useRef(answer)
  latestAnswer.current = answer
  // Dismissal mutates the lifetime once; a later ready answer cannot revive it.
  useEffect(() => {
    if (!refusal.current) return
    if (refusal.current.status !== test.doc?.status) { clearError(); return }
    if (refusal.current.kind !== 'start' && refusal.current.kind !== 'restart') return
    const successful = !!answer && !test.preflightError
    const explained = successful && !test.preflightRead?.failed && test.doc && ['draft', 'stopped'].includes(test.doc.status) && blockingSteps(answer, surface ? pageReadinessContext(test.doc, answer, surface) : test.doc).length > 0
    if (refusal.current.phase === 'rereading') {
      // Observe the answer even if another shared read has already begun.
      if (!checking || successful && answer !== refusal.current.answer) {
        refusal.current = { ...refusal.current, phase: 'waiting', answer }
        if (explained) clearError()
      }
    } else if (explained && answer !== refusal.current.answer) clearError()
  }, [answer, checking, error, test.preflightPending, test.preflightError, test.doc?.status])
  function clearError() { refusal.current = null; setError(null) }
  async function run(kind: ActionId | 'restart', request: () => Promise<ApiResult<unknown>>, { reloadOnSuccess = true } = {}) {
    if (inFlight.current || test.hasUnsaved || test.saving === 'saving') return
    clearError()
    inFlight.current = true
    setBusy(true)
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
        refusal.current = { kind, status: test.doc?.status, phase: 'rereading', answer: latestAnswer.current }
        setChecking(true)
        await test.refreshPreflight(true)
      }
    } finally { inFlight.current = false; setChecking(false) }
  }
  return { busy, checking, error, run, clearError }
}

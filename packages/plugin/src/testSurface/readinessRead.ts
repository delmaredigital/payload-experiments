import type { PreflightResult } from '../types/endpoints.js'
import { API_MESSAGES, refusalMessage } from './copy/common.js'
import { PLACEMENT_FAILURE_COPY, READINESS_COPY, placementFailureCopy } from './copy/readiness.js'
import { isPreflightResult } from './readPreflight.js'

export type ReadinessRead = ReturnType<typeof classifyReadinessRead>

/** One read policy for every surface. Pending retains this settled value verbatim. */
export function classifyReadinessRead(status: number, body?: unknown, failures = 1, placementNotice = false) {
  const answer = status === 200 && isPreflightResult(body) ? body : undefined
  const detail = answer?.checks.find(check => !check.ok && (check.code === 'no-placements' && check.detail !== undefined || check.code === 'flag-placement-missing' && typeof check.detail === 'string'))?.detail
  const kind = status === 401 ? 'signed-out' : status === 404 || detail === 'not-found' ? 'not-found'
    : status === 403 || detail === 'forbidden' ? 'no-access' : answer ? 'answered' : 'failed'
  const failed = kind === 'failed' || kind === 'answered' && detail !== undefined
  const retry = failed
  const message = kind === 'signed-out' ? refusalMessage(undefined, 401)
    : kind === 'not-found' ? answer ? PLACEMENT_FAILURE_COPY['not-found'] : API_MESSAGES.notFound
      : kind === 'no-access' ? PLACEMENT_FAILURE_COPY.forbidden
        : kind === 'failed' ? READINESS_COPY.checkError : detail !== undefined ? placementFailureCopy(detail) : undefined
  const pollDelay = retry ? [4_000, 8_000, 16_000, 30_000][Math.min(Math.max(0, failures - 1), 3)]!
    : kind === 'answered' && placementNotice ? 4_000 : null
  const loadState: 'ready' | 'missing' | 'forbidden' | 'error' = kind === 'not-found' ? 'missing' : kind === 'signed-out' || kind === 'no-access' ? 'forbidden' : kind === 'failed' ? 'error' : 'ready'
  return { status, loadState, kind, answer, message, failed, retry, pollDelay }
}

/** Legacy callers can supply an answer; producers always supply the classified read. */
export function readinessRead(test: { preflight: PreflightResult | null; preflightError: string | null; preflightRead?: ReadinessRead }) {
  return test.preflightRead ?? classifyReadinessRead(test.preflightError ? 0 : 200, test.preflight)
}

/** Settled display is independent of a refresh in progress. */
export function readyToStart(test: { preflight: PreflightResult | null; preflightError: string | null; preflightRead?: ReadinessRead }, placementMessage?: string) {
  return !!test.preflight && !placementMessage && readinessRead(test).kind === 'answered' && !test.preflightError && test.preflight.checks.every(check => check.ok)
}

/** Pending changes only the ability to fire Start, never the settled display. */
export function canStartTest(test: { preflight: PreflightResult | null; preflightError: string | null; preflightRead?: ReadinessRead; preflightPending: boolean; hasUnsaved: boolean; saving: string }, placementMessage?: string) {
  return readyToStart(test, placementMessage) && !test.preflightPending && !test.hasUnsaved && test.saving !== 'saving'
}

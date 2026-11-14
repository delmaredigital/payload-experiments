import type { PreflightResult } from '../types/endpoints.js'
import { API_MESSAGES } from './copy/common.js'
import { PLACEMENT_FAILURE_COPY, READINESS_COPY, placementFailureCopy } from './copy/readiness.js'
import { TEST_PAGE } from './copy/testPage.js'
import { editorCopy } from '../puck/editor/copy.js'
import { pickerCopy } from '../puck/copy.js'
import { isPreflightResult } from './readPreflight.js'

export type ReadinessRead = ReturnType<typeof classifyReadinessRead>

/** One read policy for every surface. Pending retains this settled value verbatim. */
export function classifyReadinessRead(status: number, body?: unknown, failures = 1, context: { kind: 'document'; surface?: 'editor'; resultsOnly?: boolean } | { kind: 'readiness' | 'where-used'; placementNotice?: boolean } = { kind: 'readiness' }) {
  const document = context.kind === 'document'
  const answer = !document && status === 200 && isPreflightResult(body) ? body : undefined
  const detail = answer?.checks.find(check => !check.ok && (check.code === 'no-placements' && check.detail !== undefined || check.code === 'flag-placement-missing' && typeof check.detail === 'string'))?.detail
  const kind = status === 401 ? 'signed-out' : status === 404 || detail === 'not-found' ? 'not-found'
    : status === 403 || detail === 'forbidden' ? 'no-access' : status === 400 || status === 501 ? 'permanent' : answer ? 'answered' : 'failed'
  const failed = kind === 'failed' || kind === 'answered' && detail !== undefined
  const retry = failed
  const message = kind === 'signed-out' ? API_MESSAGES.unauthenticated
    : kind === 'not-found' ? answer ? PLACEMENT_FAILURE_COPY['not-found'] : document && context.surface === 'editor' ? pickerCopy.unavailable : API_MESSAGES.notFound
      : kind === 'no-access' ? document ? context.surface === 'editor' ? context.resultsOnly ? pickerCopy.resultsOnly : pickerCopy.forbidden : TEST_PAGE.forbidden : PLACEMENT_FAILURE_COPY.forbidden
        : kind === 'permanent' ? status === 501 ? API_MESSAGES.notImplemented : "This request couldn't be checked. Reload the page."
          : kind === 'failed' ? document ? context.surface === 'editor' ? editorCopy.loadError : TEST_PAGE.error : READINESS_COPY.checkError : detail !== undefined ? placementFailureCopy(detail) : undefined
  // Subscribers determine whether save/publish guidance is displayed. Its polling
  // eligibility is classified here, alongside permanent and temporary failures.
  const placementNotice = !document && (context.placementNotice ?? context.kind === 'where-used')
  const pollDelay = retry ? [4_000, 8_000, 16_000, 30_000][Math.min(Math.max(0, failures - 1), 3)]!
    : kind === 'answered' && placementNotice ? 4_000 : null
  const loadState: 'ready' | 'missing' | 'forbidden' | 'error' = kind === 'not-found' ? 'missing' : kind === 'signed-out' || kind === 'no-access' ? 'forbidden' : kind === 'failed' || kind === 'permanent' ? 'error' : 'ready'
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

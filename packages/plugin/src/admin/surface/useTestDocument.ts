'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { API_MESSAGES, refusalMessage } from '../copy/common.js'
import { XP_IF_UPDATED_AT_HEADER } from '../../constants.js'
import { TEST_PAGE } from '../copy/testPage.js'
import { changedPatch, editablePatch, payloadFieldErrors } from './testDocument.model.js'
import type { TestDocument, TestDocumentPatch } from './testDocument.model.js'

type View = {
  doc: TestDocument | null
  preflight: PreflightResult | null
  preflightError: string | null
  preflightPending: boolean
  /** Includes staged edits and all queued or in-flight PATCHes. */
  hasUnsaved: boolean
  loadState: 'loading' | 'ready' | 'forbidden' | 'missing' | 'error'
  saving: 'idle' | 'saving' | 'saved' | 'error'
  stale: boolean
  /** Path-specific validation errors; _section is the fallback for a section-wide refusal. */
  errors: Record<string, string>
}
// Saves outlive their mounted reader. Reopening the same document must wait for its queue.
const drainingSaves = new Map<string, Promise<void>>()

const initialView = (): View => ({ doc: null, preflight: null, preflightError: null, preflightPending: false, hasUnsaved: false, loadState: 'loading', saving: 'idle', stale: false, errors: {} })
type Session = {
  key: string; saved: TestDocument | null; pending: TestDocumentPatch; queue: TestDocumentPatch[]
  tail: Promise<void>; view: View; controller: AbortController; reloading: boolean
  publish: () => void
  preflightReads: number
}

async function waitForDrain(draining: Promise<void> | undefined, signal: AbortSignal) {
  if (!draining) return
  let timer: ReturnType<typeof setTimeout> | undefined
  let release!: () => void
  const bounded = new Promise<void>(resolve => { release = resolve; timer = setTimeout(resolve, 15_000) })
  signal.addEventListener('abort', release, { once: true })
  try { await Promise.race([draining, bounded]) }
  finally { clearTimeout(timer); signal.removeEventListener('abort', release) }
}

function optimistic(session: Session): TestDocument | null {
  if (!session.saved) return null
  return [ ...session.queue, session.pending ].reduce<TestDocument>((doc, patch) =>
    ({ ...doc, ...editablePatch(doc.status, patch) }), session.saved)
}

function clearErrors(errors: Record<string, string>, patch: TestDocumentPatch): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([path]) => !Object.hasOwn(patch, path.split('.')[0]!)))
}

function stage(session: Session, partial: TestDocumentPatch) {
  if (!session.saved || session.view.stale || session.reloading || session.view.loadState !== 'ready' || session.controller.signal.aborted) return
  const patch = editablePatch(session.saved.status, partial)
  if (!Object.keys(patch).length) return
  session.pending = { ...session.pending, ...patch }
  session.view.errors = clearErrors(session.view.errors, patch)
  if (!session.queue.length) session.view.saving = 'idle'
  session.publish()
}

/** Section data only: staging never saves. Call commit on blur or a section action. */
export function useTestDocument(id: DocId, { apiRoute }: { apiRoute: string }) {
  const base = apiRoute.replace(/\/$/, '')
  const documentId = String(id)
  const key = JSON.stringify([base, documentId])
  const current = useRef<Session | null>(null)
  const commitRef = useRef<{ session: Session; commit: () => Promise<void>; refreshPreflight: () => Promise<void> } | null>(null)
  const defaultAttempts = useRef(new Set<string>())
  const [state, setState] = useState<{ key: string; view: View }>(() => ({ key, view: initialView() }))
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const session: Session = {
      key, saved: null, pending: {}, queue: [], tail: Promise.resolve(), view: initialView(),
      controller, reloading: false, preflightReads: 0,
      publish() {
        if (controller.signal.aborted) return
        session.view.doc = session.view.loadState === 'ready' ? optimistic(session) : null
        session.view.hasUnsaved = session.queue.length > 0 || Object.keys(session.pending).length > 0
        session.view.preflightPending = session.preflightReads > 0
        setState({ key, view: { ...session.view } })
      },
    }
    current.current = session
    const url = `${base}/xp-experiments/${encodeURIComponent(documentId)}?depth=0`

    let preflightRevision = 0
    async function refreshPreflight(initial = false) {
      if (controller.signal.aborted) return
      const revision = ++preflightRevision
      session.preflightReads++
      session.publish()
      // createApi has no signal option; this read must abort without cancelling submitted PATCHes.
      let data: PreflightResult | undefined
      let status = 0
      let message: string = API_MESSAGES.network
      try {
        const response = await fetch(`${base}/xp/experiments/${encodeURIComponent(documentId)}/preflight`, {
          method: 'GET', credentials: 'include', signal: controller.signal,
        })
        status = response.status
        const body: unknown = await response.json().catch(() => undefined)
        if (response.ok) {
          data = body as PreflightResult | undefined
          message = API_MESSAGES.unreadable
        } else {
          const envelope = body as { errors?: Array<{ code?: string; message?: string }> } | undefined
          const error = Array.isArray(envelope?.errors) ? envelope.errors[0] : undefined
          message = refusalMessage(status === 501 ? 'not-implemented' : error?.code, status,
            typeof error?.message === 'string' ? error.message : undefined)
        }
      } catch {
        message = API_MESSAGES.network
      }
      session.preflightReads--
      if (controller.signal.aborted) return
      if (revision !== preflightRevision) { session.publish(); return }
      if (data) {
        session.view.preflight = data
        session.view.preflightError = null
        if (initial) session.view.loadState = 'ready'
      } else {
        if (initial) {
          session.view.loadState = status === 403 ? 'forbidden' : status === 404 ? 'missing' : 'error'
          session.view.errors = { ...session.view.errors, _section: message }
        } else session.view.preflightError = message
      }
      session.publish()
    }

    async function readDocument(): Promise<TestDocument> {
      const response = await fetch(url, { method: 'GET', credentials: 'include', signal: controller.signal })
      if (!response.ok) throw new Error(API_MESSAGES.unreadable)
      const doc = await response.json() as TestDocument | null
      if (!doc || doc.id == null || !doc.status) throw new Error(API_MESSAGES.unreadable)
      return doc
    }

    // Capture each commit now, then diff against the latest server document when its turn arrives.
    function commit(): Promise<void> {
      if (!session.saved || session.view.stale || session.reloading || controller.signal.aborted || !Object.keys(session.pending).length) return session.tail
      const queued = session.pending
      session.pending = {}
      session.queue.push(queued)
      session.view.saving = 'saving'
      session.publish()
      const step = async () => {
        if (session.view.stale) return
        let saved = false
        let changed = false
        let failed = false
        try {
          if (!session.saved) return
          const patch = changedPatch(session.saved, queued)
          changed = Object.keys(patch).length > 0
          if (changed) {
            const headers: Record<string, string> = { 'Content-Type': 'application/json' }
            if (typeof session.saved.updatedAt === 'string') headers[XP_IF_UPDATED_AT_HEADER] = session.saved.updatedAt
            const response = await fetch(url, {
              // Submitted saves belong to the queue, not the mounted reader's lifetime.
              method: 'PATCH', credentials: 'include',
              headers, body: JSON.stringify(patch),
            })
            const body: unknown = await response.json().catch(() => undefined)
            const errors = (body as { errors?: Array<{ code?: string; message?: string }> } | undefined)?.errors
            const staleError = response.status === 409 && Array.isArray(errors)
              ? errors.find(error => error?.code === 'stale-edit') : undefined
            if (staleError) {
              session.view.stale = true
              // Keep every typed value visible, but discard all queued sends until Reload.
              session.pending = [...session.queue, session.pending].reduce((draft, edit) => ({ ...draft, ...edit }), {})
              session.queue = []
              session.view.errors = { _section: staleError.message || TEST_PAGE.staleEdit }
            } else if (!response.ok) session.view.errors = { ...session.view.errors, ...payloadFieldErrors(body) }
            else {
              // Payload collection PATCH returns { doc, message }; GET returns the doc itself.
              const doc = (body as { doc?: TestDocument } | undefined)?.doc
              const readable = doc && doc.id != null && doc.status
              // A 2xx has applied even if its response body was lost. Preserve it while re-reading.
              // The old timestamp is no longer a valid baseline. Omit the header until a
              // readable PATCH or GET restores it, including when this read is aborted.
              session.saved = readable ? doc : { ...session.saved, ...patch, updatedAt: undefined }
              saved = true
              // Keep readiness pending even while recovering an unreadable successful PATCH body.
              session.preflightReads++
              session.publish()
              session.view.errors = clearErrors(session.view.errors, patch)
              delete session.view.errors._section
              if (!readable && !controller.signal.aborted) session.saved = await readDocument()
            }
          }
        } catch (error) {
          failed = true
          session.view.errors = { ...session.view.errors, _section: error instanceof Error && error.message === API_MESSAGES.unreadable
            ? API_MESSAGES.unreadable : API_MESSAGES.network }
        } finally {
          session.queue.shift()
          // Roll back only a refused commit. Later queued or uncommitted edits remain optimistic.
          session.view.saving = session.queue.length ? 'saving' : saved ? 'saved' : changed || failed ? 'error' : 'idle'
          session.publish()
        }
        if (saved) {
          try { await refreshPreflight() }
          finally { session.preflightReads--; session.publish() }
        }
      }
      // Recover both the preceding tail and this step: unexpected throws must not strand later saves.
      session.tail = session.tail.then(step, step).catch(() => {
        session.view.errors = { ...session.view.errors, _section: API_MESSAGES.network }
        session.view.saving = session.queue.length ? 'saving' : 'error'
        session.publish()
      })
      return session.tail
    }
    // Keep callbacks attached to the session, including during automatic default persistence.
    commitRef.current = { session, commit, refreshPreflight: () => refreshPreflight() }
    session.publish()
    void (async () => {
      try {
        await waitForDrain(drainingSaves.get(key), controller.signal)
        if (controller.signal.aborted) return
        const response = await fetch(url, { method: 'GET', credentials: 'include', signal: controller.signal })
        if (controller.signal.aborted) return
        if (!response.ok) {
          session.view.loadState = response.status === 403 ? 'forbidden' : response.status === 404 ? 'missing' : 'error'
          session.publish()
          return
        }
        const doc = await response.json() as TestDocument
        if (controller.signal.aborted) return
        if (doc.id == null || !doc.status) throw new Error(API_MESSAGES.unreadable)
        session.saved = doc
        await refreshPreflight(true)
        if (controller.signal.aborted) return
        session.publish()
        if (!defaultAttempts.current.has(key) && session.view.loadState === 'ready' &&
          (doc.status === 'draft' || doc.status === 'stopped') && doc.analysis?.plannedDurationDays == null) {
          defaultAttempts.current.add(key)
          stage(session, { analysis: { ...doc.analysis, plannedDurationDays: 28 } })
          await commit()
        }
      } catch {
        if (controller.signal.aborted) return
        session.view.loadState = 'error'
        session.view.errors = { _section: API_MESSAGES.unreadable }
        session.publish()
      }
    })()
    return () => {
      controller.abort()
      if (!session.queue.length) return
      const draining = session.tail
      drainingSaves.set(key, draining)
      void draining.finally(() => {
        if (drainingSaves.get(key) === draining) drainingSaves.delete(key)
      })
    }
  }, [key, base, documentId, reloadCount])

  const stagePartial = useCallback((partial: TestDocumentPatch) => {
    const session = current.current
    if (session?.key === key) stage(session, partial)
  }, [key])
  const commit = useCallback(() => {
    const entry = commitRef.current
    return entry?.session.key === key ? entry.commit() : Promise.resolve()
  }, [key])
  const reload = useCallback(async () => {
    const session = current.current
    if (session?.key !== key || session.reloading || session.controller.signal.aborted) return
    // Finish submitted saves before reading again; even an unexpected tail failure cannot reject reload.
    session.reloading = true
    await session.tail.catch(() => undefined)
    if (current.current === session && !session.controller.signal.aborted) setReloadCount(count => count + 1)
  }, [key])
  const refreshPreflight = useCallback(() => {
    const entry = commitRef.current
    return entry?.session.key === key && entry.session.view.loadState === 'ready' && !entry.session.reloading
      ? entry.refreshPreflight() : Promise.resolve()
  }, [key])
  return { ...(state.key === key ? state.view : initialView()), stage: stagePartial, commit, reload, refreshPreflight }
}

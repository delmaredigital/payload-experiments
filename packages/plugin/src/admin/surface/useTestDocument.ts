'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DocId } from '../../types/contracts.js'
import type { PreflightResult } from '../../types/endpoints.js'
import { createApi } from '../api.js'
import { API_MESSAGES } from '../copy/common.js'
import { changedPatch, editablePatch, payloadFieldErrors } from './testDocument.model.js'
import type { TestDocument, TestDocumentPatch } from './testDocument.model.js'

type View = {
  doc: TestDocument | null
  preflight: PreflightResult | null
  loadState: 'loading' | 'ready' | 'forbidden' | 'missing' | 'error'
  saving: 'idle' | 'saving' | 'saved' | 'error'
  /** Path-specific validation errors; _section is the fallback for a section-wide refusal. */
  errors: Record<string, string>
}
const initialView = (): View => ({ doc: null, preflight: null, loadState: 'loading', saving: 'idle', errors: {} })
type Session = {
  key: string; saved: TestDocument | null; pending: TestDocumentPatch; queue: TestDocumentPatch[]
  tail: Promise<void>; view: View; controller: AbortController; reloading: boolean
  publish: () => void
}

function optimistic(session: Session): TestDocument | null {
  if (!session.saved) return null
  return [ ...session.queue, session.pending ].reduce<TestDocument>((doc, patch) =>
    ({ ...doc, ...editablePatch(doc.status, patch) }), session.saved)
}

function clearErrors(errors: Record<string, string>, patch: TestDocumentPatch): Record<string, string> {
  return Object.fromEntries(Object.entries(errors).filter(([path]) => path !== '_section' &&
    !Object.hasOwn(patch, path.split('.')[0]!)))
}

function stage(session: Session, partial: TestDocumentPatch) {
  if (!session.saved || session.reloading || session.view.loadState !== 'ready' || session.controller.signal.aborted) return
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
  const commitRef = useRef<{ session: Session; commit: () => Promise<void> } | null>(null)
  const defaultAttempts = useRef(new Set<string>())
  const [state, setState] = useState<{ key: string; view: View }>(() => ({ key, view: initialView() }))
  const [reloadCount, setReloadCount] = useState(0)

  useEffect(() => {
    const controller = new AbortController()
    const session: Session = {
      key, saved: null, pending: {}, queue: [], tail: Promise.resolve(), view: initialView(),
      controller, reloading: false,
      publish() {
        if (controller.signal.aborted) return
        session.view.doc = optimistic(session)
        setState({ key, view: { ...session.view } })
      },
    }
    current.current = session
    const api = createApi(base)
    const url = `${base}/xp-experiments/${encodeURIComponent(documentId)}?depth=0`

    async function refreshPreflight() {
      const result = await api.preflight(documentId)
      if (controller.signal.aborted) return
      if (result.ok && result.data) {
        session.view.preflight = result.data
        session.view.loadState = 'ready'
      } else {
        session.view.preflight = null
        session.view.loadState = !result.ok && result.status === 403 ? 'forbidden'
          : !result.ok && result.status === 404 ? 'missing' : 'error'
        session.view.errors = { ...session.view.errors, _section: result.ok ? API_MESSAGES.unreadable : result.message }
      }
    }

    // Capture each commit now, then diff against the latest server document when its turn arrives.
    function commit(): Promise<void> {
      if (!session.saved || session.reloading || controller.signal.aborted || !Object.keys(session.pending).length) return session.tail
      const queued = session.pending
      session.pending = {}
      session.queue.push(queued)
      session.view.saving = 'saving'
      session.publish()
      session.tail = session.tail.then(async () => {
        if (controller.signal.aborted || !session.saved) return
        const patch = changedPatch(session.saved, queued)
        let saved = false
        if (Object.keys(patch).length) {
          try {
            const response = await fetch(url, {
              method: 'PATCH', credentials: 'include', signal: controller.signal,
              headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
            })
            const body: unknown = await response.json().catch(() => undefined)
            if (controller.signal.aborted) return
            if (!response.ok) session.view.errors = { ...session.view.errors, ...payloadFieldErrors(body) }
            else {
              // Payload collection PATCH returns { doc, message }; GET returns the doc itself.
              const doc = (body as { doc?: TestDocument } | undefined)?.doc
              if (!doc || doc.id == null || !doc.status) throw new Error(API_MESSAGES.unreadable)
              session.saved = doc
              session.view.errors = clearErrors(session.view.errors, patch)
              saved = true
            }
          } catch (error) {
            if (controller.signal.aborted) return
            session.view.errors = { ...session.view.errors, _section: error instanceof Error && error.message === API_MESSAGES.unreadable
              ? API_MESSAGES.unreadable : API_MESSAGES.network }
          }
        }
        session.queue.shift()
        // Roll back only this commit. Later queued or uncommitted edits remain optimistic.
        session.view.saving = session.queue.length ? 'saving' : saved ? 'saved' : Object.keys(patch).length ? 'error' : 'idle'
        session.publish()
        if (saved) {
          await refreshPreflight()
          session.publish()
        }
      })
      return session.tail
    }
    // Keep callbacks attached to the session, including during automatic default persistence.
    commitRef.current = { session, commit }
    session.publish()
    void (async () => {
      try {
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
        await refreshPreflight()
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
    return () => controller.abort()
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
    // A submitted PATCH can still commit after fetch is aborted. Finish the queue before reading again.
    session.reloading = true
    await session.tail
    if (current.current === session && !session.controller.signal.aborted) setReloadCount(count => count + 1)
  }, [key])
  return { ...(state.key === key ? state.view : initialView()), stage: stagePartial, commit, reload }
}

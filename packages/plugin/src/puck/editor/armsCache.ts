'use client'

import { useSyncExternalStore } from 'react'
import type { DocId } from '../../types/contracts.js'
import type { EditorExperiment } from './editor.model.js'

type Arms = { arms: string[] }
const cache = new Map<string, Arms>()
const listeners = new Set<() => void>()
type Pending = { controller: AbortController; consumers: AbortSignal[]; promise: Promise<EditorExperiment> }
const pending = new Map<string, Pending>()
const mounted = new Map<string, number>()

/** Only the first mounted block discards a document left by an earlier editor. */
export function acquireArms(testId: DocId): () => void {
  const key = String(testId)
  const count = mounted.get(key) ?? 0
  mounted.set(key, count + 1)
  if (count === 0 && !pending.has(key)) setArms(testId, undefined)
  let released = false
  return () => {
    if (released) return
    released = true
    const count = (mounted.get(key) ?? 1) - 1
    if (count === 0) mounted.delete(key)
    else mounted.set(key, count)
  }
}

/** Share the request, but abort it only after its last mounted consumer leaves. */
export function loadArms(testId: DocId, load: (signal: AbortSignal) => Promise<EditorExperiment>, signal: AbortSignal): Promise<EditorExperiment> {
  const key = String(testId)
  let request = pending.get(key)
  if (!request) {
    const controller = new AbortController()
    request = { controller, consumers: [], promise: undefined! }
    const entry = request
    entry.promise = load(controller.signal).then(doc => {
      if (!controller.signal.aborted) setArms(testId, doc.arms.map(arm => arm.key))
      return doc
    }, error => {
      if (!controller.signal.aborted) setArms(testId, undefined)
      throw error
    }).finally(() => { if (pending.get(key) === entry) pending.delete(key) })
    pending.set(key, entry)
  }
  const entry = request
  if (!entry.consumers.includes(signal)) entry.consumers.push(signal)
  const release = () => {
    entry.consumers = entry.consumers.filter(consumer => consumer !== signal)
    if (!entry.consumers.length) {
      entry.controller.abort()
      if (pending.get(key) === entry) pending.delete(key)
    }
  }
  signal.addEventListener('abort', release, { once: true })
  return entry.promise.finally(() => {
    signal.removeEventListener('abort', release)
    entry.consumers = entry.consumers.filter(consumer => consumer !== signal)
  })
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** The editor's document fetch is the only producer; undefined means unknown. */
export function setArms(testId: DocId, arms: string[] | undefined): void {
  if (arms) cache.set(String(testId), { arms: [...arms] })
  else cache.delete(String(testId))
  for (const listener of listeners) listener()
}

const unknown = () => undefined
export function useArms(testId: DocId | undefined): Arms | undefined {
  return useSyncExternalStore(subscribe, () => testId === undefined ? undefined : cache.get(String(testId)), unknown)
}

'use client'

import { useSyncExternalStore } from 'react'
import type { DocId } from '../../types/contracts.js'

type Arms = { arms: string[] }
const cache = new Map<string, Arms>()
const listeners = new Set<() => void>()

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

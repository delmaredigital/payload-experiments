'use client'

import { createUsePuck, useGetPuck } from '@puckeditor/core'
import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ExperimentRef } from '../../types/puck.js'
import { ExperimentPicker } from '../ExperimentPicker.js'
import { editorCopy as C } from './copy.js'

const usePuckSelector = createUsePuck()
type Targets = { test: HTMLElement; controls: HTMLElement }
type Bridge = { targets: Map<string, Targets>; listeners: Set<() => void> }
// useGetPuck returns the store's stable getState function (Puck 0.24:7223–7228).
// A WeakMap keeps separate editors (including their iframes) isolated.
const bridges = new WeakMap<object, Bridge>()
function bridge(session: object): Bridge {
  let entry = bridges.get(session)
  if (!entry) { entry = { targets: new Map(), listeners: new Set() }; bridges.set(session, entry) }
  return entry
}
export function useSidebarTargets(id: string) {
  const entry = bridge(useGetPuck())
  return useSyncExternalStore(notify => { entry.listeners.add(notify); return () => { entry.listeners.delete(notify) } },
    () => entry.targets.get(id), () => undefined)
}

/** The custom field owns only its picker and portal destinations, never another data reader. */
export function TestSidebarField({ value, onChange }: { value: ExperimentRef | null; onChange: (value: ExperimentRef | null) => void }) {
  const getPuck = useGetPuck()
  const id = usePuckSelector(state => state.selectedItem?.props.id)
  const [test, setTest] = useState<HTMLDivElement | null>(null)
  const [controls, setControls] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!id || !test || !controls) return
    const entry = bridge(getPuck)
    const targets = { test, controls }
    entry.targets.set(id, targets)
    for (const notify of entry.listeners) notify()
    return () => {
      if (entry.targets.get(id) === targets) entry.targets.delete(id)
      for (const notify of entry.listeners) notify()
    }
  }, [id, test, controls, getPuck])
  return <div className="xp-slot-root xp-slot-editor xp-slot-sidebar" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <section aria-label={C.testGroup}><h4>{C.testGroup}</h4><ExperimentPicker value={value} onChange={onChange} /><div ref={setTest} /></section>
    <div ref={setControls} />
  </div>
}

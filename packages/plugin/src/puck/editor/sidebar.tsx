'use client'

import { createUsePuck, useGetPuck } from '@puckeditor/core'
import { useEffect, useState, useSyncExternalStore, useRef } from 'react'
import type { ExperimentRef } from '../../types/puck.js'

const usePuckSelector = createUsePuck()
type Targets = { test: HTMLElement; controls: HTMLElement; onChange: (value: ExperimentRef | null) => void }
type Bridge = {
  targets: Map<string, Targets>; listeners: Set<() => void>
  removeListener: (notify: () => void) => void; removeTarget: (id: string) => void
}
// useGetPuck returns the store's stable getState function (Puck 0.24:7223–7228).
// A WeakMap keeps separate editors (including their iframes) isolated.
const bridges = new WeakMap<object, Bridge>()
function bridge(session: object): Bridge {
  let entry = bridges.get(session)
  if (!entry) {
    const targets = new Map<string, Targets>()
    const listeners = new Set<() => void>()
    entry = { targets, listeners, removeListener: notify => { listeners.delete(notify) }, removeTarget: id => { targets.delete(id) } }
    bridges.set(session, entry)
  }
  return entry
}
export function useSidebarTargets(id: string) {
  const entry = bridge(useGetPuck())
  return useSyncExternalStore(notify => { entry.listeners.add(notify); return () => { entry.removeListener(notify) } },
    () => entry.targets.get(id), () => undefined)
}

/** The custom field owns only its portal destinations and binding callback, never another data reader. */
export function TestSidebarField({ onChange }: { onChange: (value: ExperimentRef | null) => void }) {
  const getPuck = useGetPuck()
  const change = useRef(onChange)
  change.current = onChange
  const id = usePuckSelector(state => state.selectedItem?.props.id)
  const [test, setTest] = useState<HTMLDivElement | null>(null)
  const [controls, setControls] = useState<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!id || !test || !controls) return
    const entry = bridge(getPuck)
    const targets = { test, controls, onChange: (value: ExperimentRef | null) => change.current(value) }
    entry.targets.set(id, targets)
    for (const notify of entry.listeners) notify()
    return () => {
      if (entry.targets.get(id) === targets) entry.removeTarget(id)
      for (const notify of entry.listeners) notify()
    }
  }, [id, test, controls, getPuck])
  return <div className="xp-slot-root xp-slot-editor xp-puck-field xp-slot-sidebar" onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <div ref={setTest} />
    <div ref={setControls} />
  </div>
}

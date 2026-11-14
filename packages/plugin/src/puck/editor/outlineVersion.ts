import { useSyncExternalStore } from 'react'
import type { ArmSlot } from '../../types/puck.js'

// useGetPuck returns the editor store's stable getState function (Puck 0.24).
// Weak keys isolate editors, including two with the same block ids on one page.
type Editor = object
type Entry = { slot?: ArmSlot; listeners: Set<() => void>; removeListener: (notify: () => void) => void }
const editors = new WeakMap<Editor, Map<string, Entry>>()
function entryFor(editor: Editor, id: string): Entry {
  let entries = editors.get(editor)
  if (!entries) { entries = new Map(); editors.set(editor, entries) }
  let entry = entries.get(id)
  if (!entry) {
    const listeners = new Set<() => void>()
    entry = { listeners, removeListener: notify => { listeners.delete(notify) } }
    entries.set(id, entry)
  }
  return entry
}
export function publishOutlineVersion(editor: Editor, id: string, slot?: ArmSlot) {
  const entry = entryFor(editor, id)
  if (entry.slot === slot) return
  entry.slot = slot
  for (const notify of entry.listeners) notify()
}
export function useOutlineVersion(editor: Editor, id: string) {
  const entry = entryFor(editor, id)
  return useSyncExternalStore(notify => {
    entry.listeners.add(notify)
    return () => { entry.removeListener(notify) }
  }, () => entry.slot, () => undefined)
}

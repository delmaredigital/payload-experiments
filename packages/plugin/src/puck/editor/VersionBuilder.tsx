'use client'
import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react'
import { addVariant, removeArm, balanceWeight, splitEvenly, totalWeight, withSlotsFor } from '../../arms/model.js'
import { checkArms } from '../../collections/experiments/armInvariants.js'
import { issueMessage } from '../../arms/copy.js'
import type { Arm, ArmKey } from '../../types/contracts.js'
import type { ArmSlot } from '../../types/puck.js'
import { Button } from '../../ui/Button.js'
import { Dialog } from '../../ui/Dialog.js'
import { NumberInput, TextInput } from '../../ui/Inputs.js'
import type { EditorExperiment } from './editor.model.js'
import { ArmWriteError, writeArms } from './armWrites.js'
import { editorCopy as C } from './copy.js'

export function useArmWrites(url: string, publish: (doc: EditorExperiment) => void, isCurrent: () => boolean, onWrite: () => void, onSaved?: () => void) {
  const guard = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function write(transform: (arms: Arm[]) => Arm[], options?: { draftOnly?: boolean }): Promise<Arm[] | undefined> {
    if (guard.current) return
    guard.current = true
    onWrite()
    setBusy(true); setError(null)
    try { const saved = await writeArms(url, transform, publish, options); onSaved?.(); return saved }
    catch (error) { if (isCurrent()) setError(error instanceof ArmWriteError ? error.message : C.writeNetwork) }
    finally { guard.current = false; setBusy(false) }
  }
  return { write, busy, error }
}
export type ArmWrites = ReturnType<typeof useArmWrites>

export function AddVariant({ experiment, writes, onSelect }: { experiment: EditorExperiment; writes: ArmWrites; onSelect: (slot: ArmSlot) => void }) {
  if (experiment.arms.filter(arm => arm.kind === 'variant').length >= 3) return null
  return <Button disabled={writes.busy} onClick={async () => {
    let added: ArmSlot | undefined
    const saved = await writes.write(arms => {
      const next = addVariant(arms, 'block')
      added = next.find(arm => !arms.some(existing => existing.key === arm.key))?.key as ArmSlot | undefined
      return next
    })
    if (saved && added) onSelect(added)
  }}>{C.add}</Button>
}

export function VersionActions({ arm, writes, editable, running = false, open, onOpenChange, canCopy, onCopy, onRequestRemove }: {
  arm: EditorExperiment['arms'][number]; writes: ArmWrites; editable: boolean; running?: boolean; open: boolean; onOpenChange: (open: boolean) => void; canCopy: boolean
  onCopy: (slot: ArmSlot) => void; onRequestRemove: () => void
}) {
  const id = useId()
  const [name, setName] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const trigger = useRef<HTMLDivElement>(null)
  const focusTrigger = () => trigger.current?.querySelector<HTMLButtonElement>('button')?.focus()
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (restoreFocus.current && !writes.busy) { restoreFocus.current = false; focusTrigger() }
  }, [writes.busy, name])
  useEffect(() => {
    if (!open) return
    const node = trigger.current
    const doc = node?.ownerDocument
    const outside = (event: PointerEvent) => { if (node && !event.composedPath().includes(node)) onOpenChange(false) }
    // Focus leaving the canvas iframe (Puck's own panels) or the window fires window blur, not a document pointerdown.
    const leave = () => onOpenChange(false)
    const view = doc?.defaultView
    doc?.addEventListener('pointerdown', outside, true)
    view?.addEventListener('blur', leave)
    return () => { doc?.removeEventListener('pointerdown', outside, true); view?.removeEventListener('blur', leave) }
  }, [open, onOpenChange])
  const closeMenu = () => { onOpenChange(false); focusTrigger() }
  const slot = arm.key as ArmSlot
  async function rename() {
    if (!name?.trim()) { setInvalid(true); return }
    const label = name.trim()
    const saved = await writes.write(arms => arms.map(current => current.key === arm.key ? { ...current, label } : current))
    if (saved) { restoreFocus.current = true; setName(null) }
  }
  return <div ref={trigger} className="xp-slot-version-actions" onBlur={event => {
    // Safari/Firefox may blur a keyboard-focused trigger without focusing the clicked item.
    // Outside pointerdown handles real outside clicks, including non-focusable targets.
    if (event.relatedTarget !== null && !event.currentTarget.contains(event.relatedTarget)) onOpenChange(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape' && !writes.busy) { event.preventDefault(); closeMenu(); setName(null) }
  }}>
    <div className="xp-slot-version-anchor">
    {editable || arm.kind !== 'control' ? <Button size="sm" variant="quiet" aria-label={C.menu(arm.label)} aria-expanded={open} aria-controls={`${id}-menu`}
      disabled={writes.busy} onClick={() => onOpenChange(!open)}>{C.options} ▾</Button> : null}
    {open ? <div id={`${id}-menu`} className="xp-slot-version-menu" role="group" tabIndex={-1} aria-label={C.menu(arm.label)}>
      {editable ? <Button variant="quiet" size="sm" onClick={() => { setName(arm.label); setInvalid(false); closeMenu() }}>{C.rename}</Button> : null}
      {arm.kind === 'variant' ? <>
        <Button variant="quiet" size="sm" disabled={!canCopy} onClick={() => { closeMenu(); onCopy(slot) }}>{C.copy}</Button>{!canCopy ? <p className="xp-ui-help">{C.copyEmpty}</p> : null}
      </> : null}
      {arm.kind !== 'control' && editable ? <Button variant="quiet" size="sm" onClick={() => { closeMenu(); onRequestRemove() }}>{C.removeVersion}</Button> : null}
      {running ? <p className="xp-ui-help">{C.runningVersions}</p> : null}
    </div> : null}
    </div>
    {name !== null ? <div className="xp-slot-version-rename"><TextInput id={`${id}-name`} label={C.renameLabel} autoFocus value={name} disabled={writes.busy}
      error={invalid ? C.emptyLabel : undefined} onChange={event => { setName(event.target.value); setInvalid(false) }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void rename() } }} /></div> : null}

  </div>
}

export function RemoveVersion({ arm, writes, count, shared, onRemove, onClose }: {
  arm: EditorExperiment['arms'][number]; writes: ArmWrites; count: number; shared: boolean | undefined; onRemove: (slot: ArmSlot) => void; onClose: () => void
}) {
  const slot = arm.key === 'holdout' ? undefined : arm.key as ArmSlot
  const [tried, setTried] = useState(false)
  return <Dialog open title={C.removeTitle(arm.label)} initialFocus="cancel" dismissible={!writes.busy} onClose={() => onClose()}>
      <div className="xp-slot-drawer"><p>{C.removeHelp(count)}</p>{shared === undefined ? <p>{C.removeScopeUnknown}</p> : shared ? <p>{C.removeShared}</p> : null}
      {tried && writes.error ? <p role="alert" className="xp-ui-error">{writes.error}</p> : null}
      <div className="xp-ui-button-group">
        <Button data-dialog-cancel disabled={writes.busy} onClick={() => onClose()}>{C.cancel}</Button>
        <Button variant="danger" busy={writes.busy} onClick={async () => {
          setTried(true)
          const saved = await writes.write(arms => splitEvenly(removeArm(arms, arm.key)))
          if (saved) { if (slot) onRemove(slot); onClose() }
        }}>{C.remove}</Button>
      </div></div>
    </Dialog>
}

export type WeightEdits = Partial<Record<ArmKey, string>>
export function VersionWeights({ experiment, writes, edits, setEdits, groupId, splitIntent, editable = true, beforeSplit, actions }: { experiment: EditorExperiment; writes: ArmWrites; edits: WeightEdits; setEdits: (edits: WeightEdits) => void; groupId: string; splitIntent: RefObject<boolean>; editable?: boolean; beforeSplit?: ReactNode; actions?: (arm: EditorExperiment['arms'][number]) => ReactNode }) {
  const id = useId()
  const split = useRef<HTMLDivElement>(null)
  const invalidKeys = new Set(Object.entries(edits).filter(([, raw]) => raw.trim() === '' || !Number.isInteger(Number(raw)) || Number(raw) < 0 || Number(raw) > 100).map(([key]) => key))
  const apply = (arms: Arm[]) => arms.reduce((next, arm) => edits[arm.key] === undefined ? next : (() => {
    const value = edits[arm.key]!.trim() === '' ? NaN : Number(edits[arm.key])
    return invalidKeys.has(arm.key) ? next : balanceWeight(next, arm.key, value)
  })(), arms)
  const live = withSlotsFor(apply(experiment.arms as Arm[]), 'block')
  const issues = checkArms(live, 'block')
  async function commit() {
    if (!Object.keys(edits).length || invalidKeys.size || issues.length) return
    await writes.write(apply)
  }
  return <div className="xp-slot-weights">
    <div className="xp-slot-weight-inputs">{experiment.arms.map(arm => <div className="xp-slot-weight-row" key={arm.key}><NumberInput id={`${id}-${arm.key}`} label={C.weight(arm.label)}
      min={0} max={100} step={1} value={edits[arm.key] ?? live.find(current => current.key === arm.key)?.weight ?? ''} disabled={writes.busy || !editable}
      error={invalidKeys.has(arm.key) ? C.invalidShare : undefined}
      onChange={event => setEdits({ [arm.key]: event.target.value })}
      onBlur={event => { const target = event.relatedTarget as Element | null; if (!splitIntent.current && !(typeof target?.closest === 'function' && target.closest('[data-xp-split]')?.getAttribute('data-xp-split') === groupId)) void commit() }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit() } }} />{actions?.(arm)}</div>)}</div>
    {Object.keys(edits).length && !invalidKeys.size ? issues.map((issue, i) => <p role="alert" className="xp-ui-error" key={i}>{issueMessage(issue, totalWeight(live))}</p>) : null}
    {beforeSplit}
    {editable ? <div ref={split} data-xp-split={groupId} onPointerDownCapture={() => {
      // Pointer intent reaches the destination before the source iframe loses focus.
      splitIntent.current = true
      setTimeout(() => { splitIntent.current = false }, 0)
    }}><Button variant="quiet" size="sm" disabled={writes.busy} onClick={() => void writes.write(splitEvenly)}>{C.split}</Button></div> : null}
  </div>
}

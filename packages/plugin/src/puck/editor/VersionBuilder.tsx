'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { addVariant, removeArm, balanceWeight, setWeight, splitEvenly, totalWeight, withSlotsFor } from '../../arms/model.js'
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

export function useArmWrites(url: string, publish: (doc: EditorExperiment) => void, isCurrent: () => boolean) {
  const guard = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function write(transform: (arms: Arm[]) => Arm[]): Promise<Arm[] | undefined> {
    if (guard.current) return
    guard.current = true
    setBusy(true); setError(null)
    try { return await writeArms(url, transform, publish) }
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

export function VersionActions({ arm, writes, editable, open, onOpenChange, canCopy, onCopy, onRequestRemove }: {
  arm: EditorExperiment['arms'][number]; writes: ArmWrites; editable: boolean; open: boolean; onOpenChange: (open: boolean) => void; canCopy: boolean
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
    doc?.addEventListener('pointerdown', outside)
    return () => doc?.removeEventListener('pointerdown', outside)
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
    if (!event.currentTarget.contains(event.relatedTarget)) onOpenChange(false)
  }} onKeyDown={event => {
    if (event.key === 'Escape' && !writes.busy) { event.preventDefault(); closeMenu(); setName(null) }
  }}>
    {editable || arm.kind !== 'control' ? <Button size="sm" variant="quiet" aria-label={C.menu(arm.label)} aria-expanded={open} aria-controls={`${id}-menu`}
      disabled={writes.busy} onClick={() => onOpenChange(!open)}>⋯</Button> : null}
    {open ? <div id={`${id}-menu`} className="xp-slot-version-menu" aria-label={C.menu(arm.label)}>
      {editable ? <Button variant="quiet" size="sm" onClick={() => { setName(arm.label); setInvalid(false); closeMenu() }}>{C.rename}</Button> : null}
      {arm.kind !== 'control' ? <>
        <Button variant="quiet" size="sm" disabled={!canCopy} onClick={() => { closeMenu(); onCopy(slot) }}>{C.copy}</Button>
        {editable ? <Button variant="quiet" size="sm" onClick={() => { closeMenu(); onRequestRemove() }}>{C.remove}</Button> : null}
      </> : null}
    </div> : null}
    {name !== null ? <TextInput id={`${id}-name`} label={C.renameLabel} autoFocus value={name} disabled={writes.busy}
      error={invalid ? C.emptyLabel : undefined} onChange={event => { setName(event.target.value); setInvalid(false) }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void rename() } }} /> : null}

  </div>
}

export function RemoveVersion({ arm, writes, onRemove, onClose }: {
  arm: EditorExperiment['arms'][number]; writes: ArmWrites; onRemove: (slot: ArmSlot) => void; onClose: () => void
}) {
  const slot = arm.key as ArmSlot
  return <Dialog open title={C.removeTitle(arm.label)} initialFocus="cancel" dismissible={!writes.busy} onClose={() => onClose()}>
      <div className="xp-slot-drawer"><p>{C.removeHelp}</p>
      {writes.error ? <p role="alert" className="xp-ui-error">{writes.error}</p> : null}
      <div className="xp-ui-button-group">
        <Button data-dialog-cancel disabled={writes.busy} onClick={() => onClose()}>{C.cancel}</Button>
        <Button variant="danger" busy={writes.busy} onClick={async () => {
          const saved = await writes.write(arms => splitEvenly(removeArm(arms, arm.key)))
          if (saved) { onRemove(slot); onClose() }
        }}>{C.remove}</Button>
      </div></div>
    </Dialog>
}

export function VersionWeights({ experiment, writes }: { experiment: EditorExperiment; writes: ArmWrites }) {
  const id = useId()
  const split = useRef<HTMLDivElement>(null)
  const [edits, setEdits] = useState<Partial<Record<ArmKey, string>>>({})
  const apply = (arms: Arm[]) => arms.reduce((next, arm) => edits[arm.key] === undefined ? next : (() => {
    const value = edits[arm.key]!.trim() === '' ? NaN : Number(edits[arm.key])
    return Number.isInteger(value) && value >= 0 && value <= 100 ? balanceWeight(next, arm.key, value) : setWeight(next, arm.key, value)
  })(), arms)
  const live = withSlotsFor(apply(experiment.arms as Arm[]), 'block')
  const issues = checkArms(live, 'block')
  async function commit() {
    if (!Object.keys(edits).length || issues.length) return
    const saved = await writes.write(apply)
    if (saved) setEdits({})
  }
  return <div className="xp-slot-weights">
    <div className="xp-slot-weight-inputs">{experiment.arms.map(arm => <NumberInput key={arm.key} id={`${id}-${arm.key}`} label={C.weight(arm.label)}
      min={0} max={100} step={1} value={edits[arm.key] ?? live.find(current => current.key === arm.key)?.weight ?? ''} disabled={writes.busy}
      onChange={event => setEdits({ [arm.key]: event.target.value })}
      onBlur={event => { if (!split.current?.contains(event.relatedTarget)) void commit() }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit() } }} />)}</div>
    {Object.keys(edits).length ? issues.map((issue, i) => <p role="alert" className="xp-ui-error" key={i}>{issueMessage(issue, totalWeight(live))}</p>) : null}
    <div ref={split}><Button variant="quiet" size="sm" disabled={writes.busy} onClick={async () => { if (await writes.write(splitEvenly)) setEdits({}) }}>{C.split}</Button></div>
  </div>
}

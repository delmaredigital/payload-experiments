'use client'
import { useEffect, useId, useRef, useState } from 'react'
import { addVariant, removeArm, setWeight, splitEvenly, totalWeight, withSlotsFor } from '../../arms/model.js'
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
  return <Button size="sm" disabled={writes.busy} onClick={async () => {
    let added: ArmSlot | undefined
    const saved = await writes.write(arms => {
      const next = addVariant(arms, 'block')
      added = next.find(arm => !arms.some(existing => existing.key === arm.key))?.key as ArmSlot | undefined
      return next
    })
    if (saved && added) onSelect(added)
  }}>{C.add}</Button>
}

export function VersionActions({ arm, writes, canCopy, onCopy, onRemove }: {
  arm: EditorExperiment['arms'][number]; writes: ArmWrites; canCopy: boolean
  onCopy: (slot: ArmSlot) => void; onRemove: (slot: ArmSlot) => void
}) {
  const id = useId()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [removing, setRemoving] = useState(false)
  const trigger = useRef<HTMLDivElement>(null)
  const focusTrigger = () => trigger.current?.querySelector<HTMLButtonElement>('button')?.focus()
  const restoreFocus = useRef(false)
  useEffect(() => {
    if (restoreFocus.current && !writes.busy) { restoreFocus.current = false; focusTrigger() }
  }, [writes.busy, name])
  const closeMenu = () => { setOpen(false); focusTrigger() }
  const slot = arm.key as ArmSlot
  async function rename() {
    if (!name?.trim()) { setInvalid(true); return }
    const label = name.trim()
    const saved = await writes.write(arms => arms.map(current => current.key === arm.key ? { ...current, label } : current))
    if (saved) { restoreFocus.current = true; setName(null) }
  }
  return <div ref={trigger} className="xp-slot-version-actions" onKeyDown={event => {
    if (event.key === 'Escape' && !writes.busy) { event.preventDefault(); closeMenu(); setName(null) }
  }}>
    <Button size="sm" variant="quiet" aria-label={C.menu(arm.label)} aria-expanded={open} aria-controls={`${id}-menu`}
      disabled={writes.busy} onClick={() => setOpen(!open)}>⋯</Button>
    {open ? <div id={`${id}-menu`} className="xp-slot-version-menu" aria-label={C.menu(arm.label)}>
      <Button variant="quiet" size="sm" onClick={() => { setName(arm.label); setInvalid(false); closeMenu() }}>{C.rename}</Button>
      {arm.kind !== 'control' ? <>
        <Button variant="quiet" size="sm" disabled={!canCopy} onClick={() => { closeMenu(); onCopy(slot) }}>{C.copy}</Button>
        <Button variant="quiet" size="sm" onClick={() => { closeMenu(); setRemoving(true) }}>{C.remove}</Button>
      </> : null}
    </div> : null}
    {name !== null ? <TextInput id={`${id}-name`} label={C.renameLabel} autoFocus value={name} disabled={writes.busy}
      error={invalid ? C.emptyLabel : undefined} onChange={event => { setName(event.target.value); setInvalid(false) }}
      onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void rename() } }} /> : null}
    {removing ? <Dialog open title={C.removeTitle(arm.label)} initialFocus="cancel" dismissible={!writes.busy} onClose={() => setRemoving(false)}>
      <p>{C.removeHelp}</p><div className="xp-ui-button-group">
        <Button data-dialog-cancel disabled={writes.busy} onClick={() => setRemoving(false)}>{C.cancel}</Button>
        <Button variant="danger" busy={writes.busy} onClick={async () => {
          const saved = await writes.write(arms => splitEvenly(removeArm(arms, arm.key)))
          if (saved) { onRemove(slot); setRemoving(false) }
        }}>{C.remove}</Button>
      </div>
    </Dialog> : null}
  </div>
}

export function VersionWeights({ experiment, writes }: { experiment: EditorExperiment; writes: ArmWrites }) {
  const id = useId()
  const split = useRef<HTMLDivElement>(null)
  const [edits, setEdits] = useState<Partial<Record<ArmKey, string>>>({})
  const apply = (arms: Arm[]) => arms.reduce((next, arm) => edits[arm.key] === undefined ? next : setWeight(next, arm.key,
    edits[arm.key]!.trim() === '' ? NaN : Number(edits[arm.key])), arms)
  const live = withSlotsFor(apply(experiment.arms as Arm[]), 'block')
  const issues = checkArms(live, 'block')
  async function commit() {
    if (!Object.keys(edits).length || issues.length) return
    const saved = await writes.write(apply)
    if (saved) setEdits({})
  }
  return <div className="xp-slot-weights">
    <div className="xp-slot-weight-inputs">{experiment.arms.map(arm => <NumberInput key={arm.key} id={`${id}-${arm.key}`} label={C.weight(arm.label)}
      min={0} max={100} step={1} value={edits[arm.key] ?? arm.weight ?? ''} disabled={writes.busy}
      onChange={event => setEdits(current => ({ ...current, [arm.key]: event.target.value }))}
      onBlur={event => { if (!split.current?.contains(event.relatedTarget)) void commit() }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit() } }} />)}</div>
    {Object.keys(edits).length ? issues.map((issue, i) => <p role="alert" key={i}>{issueMessage(issue, totalWeight(live))}</p>) : null}
    <div ref={split}><Button variant="quiet" size="sm" disabled={writes.busy} onClick={async () => { if (await writes.write(splitEvenly)) setEdits({}) }}>{C.split}</Button></div>
  </div>
}

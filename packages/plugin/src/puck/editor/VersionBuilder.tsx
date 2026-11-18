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

/** Always-visible editor for the saved version name. */
export function VersionName({ arm, writes, editable }: { arm: EditorExperiment['arms'][number]; writes: ArmWrites; editable: boolean }) {
  const id = useId()
  const [name, setName] = useState(arm.label)
  const draft = useRef(arm.label)
  const pending = useRef(false)
  const [attempted, setAttempted] = useState(false)
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { draft.current = arm.label; setName(arm.label) }, [arm.label])
  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [saved])
  async function commit() {
    if (!editable || pending.current || writes.busy || draft.current === arm.label) return
    if (!draft.current.trim()) { setInvalid(true); return }
    const label = draft.current.trim()
    pending.current = true
    setAttempted(true); setSaved(false)
    try {
      const result = await writes.write(arms => arms.map(current => current.key === arm.key ? { ...current, label } : current))
      if (result) setSaved(true)
    } finally { pending.current = false }
  }
  return <div className="xp-slot-version-name"><TextInput id={id} label={C.name} aria-label={`${arm.label} ${C.name}`} value={name}
    readOnly={!editable} disabled={writes.busy} error={invalid ? C.emptyLabel : attempted ? writes.error ?? undefined : undefined}
    onChange={event => { draft.current = event.target.value; setName(event.target.value); setInvalid(false); setAttempted(false); setSaved(false) }}
    onBlur={() => void commit()} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); void commit() }
      if (event.key === 'Escape') { event.preventDefault(); draft.current = arm.label; setName(arm.label); setInvalid(false); setAttempted(false); setSaved(false) }
    }} />{saved ? <span role="status" className="xp-ui-help">{C.saved}</span> : null}</div>
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
export function VersionWeights({ experiment, writes, edits, setEdits, groupId, splitIntent, editable = true, beforeSplit, renderRow }: { experiment: EditorExperiment; writes: ArmWrites; edits: WeightEdits; setEdits: (edits: WeightEdits) => void; groupId: string; splitIntent: RefObject<boolean>; editable?: boolean; beforeSplit?: ReactNode; renderRow?: (arm: EditorExperiment['arms'][number], input: ReactNode) => ReactNode }) {
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
    <div className="xp-slot-weight-inputs">{experiment.arms.map(arm => { const input = <NumberInput id={`${id}-${arm.key}`} label={C.traffic} aria-label={C.weight(arm.label)}
      min={0} max={100} step={1} value={edits[arm.key] ?? live.find(current => current.key === arm.key)?.weight ?? ''} disabled={writes.busy} readOnly={!editable}
      error={invalidKeys.has(arm.key) ? C.invalidShare : undefined}
      onChange={event => setEdits({ [arm.key]: event.target.value })}
      onBlur={event => { const target = event.relatedTarget as Element | null; if (!splitIntent.current && !(typeof target?.closest === 'function' && target.closest('[data-xp-split]')?.getAttribute('data-xp-split') === groupId)) void commit() }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit() } }} />; return <div key={arm.key}>{renderRow ? renderRow(arm, input) : input}</div> })}</div>
    {Object.keys(edits).length && !invalidKeys.size ? issues.map((issue, i) => <p role="alert" className="xp-ui-error" key={i}>{issueMessage(issue, totalWeight(live))}</p>) : null}
    {beforeSplit}
    {editable ? <div ref={split} data-xp-split={groupId} onPointerDownCapture={() => {
      // Pointer intent reaches the destination before the source iframe loses focus.
      splitIntent.current = true
      setTimeout(() => { splitIntent.current = false }, 0)
    }}><Button variant="quiet" size="sm" disabled={writes.busy} onClick={() => void writes.write(splitEvenly)}>{C.split}</Button></div> : null}
  </div>
}

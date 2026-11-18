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
  const running = useRef<Promise<void>>(Promise.resolve())
  const [busy, setBusy] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const clearError = (key: string) => setErrors(current => { const next = { ...current }; delete next[key]; return next })
  async function write(transform: (arms: Arm[]) => Arm[], options?: { draftOnly?: boolean; onError?: (message: string) => void; queue?: boolean; cancelled?: () => boolean; onStart?: () => void; errorKey?: string }): Promise<Arm[] | undefined> {
    if (options?.queue) {
      while (guard.current) await running.current
      if (options.cancelled?.()) return
      if (!isCurrent()) { options.onError?.(C.staleEdit); return }
    } else if (guard.current) return
    let release!: () => void
    running.current = new Promise<void>(resolve => { release = resolve })
    guard.current = true
    options?.onStart?.()
    onWrite()
    setBusy(true)
    const errorKey = options?.errorKey ?? 'add'
    if (!options?.onError) clearError(errorKey)
    try { const saved = await writeArms(url, transform, publish, options); onSaved?.(); return saved }
    catch (error) { if (isCurrent()) { const message = error instanceof ArmWriteError ? error.message : C.writeNetwork; if (options?.onError) options.onError(message); else setErrors(current => ({ ...current, [errorKey]: message })) } }
    finally { guard.current = false; setBusy(false); release() }
  }
  return { write, busy, error: Object.values(errors).join(' '), errorFor: (key: string) => errors[key], clearError }
}
export type ArmWrites = ReturnType<typeof useArmWrites>

export function AddVariant({ experiment, writes, onSelect }: { experiment: EditorExperiment; writes: ArmWrites; onSelect: (slot: ArmSlot) => void }) {
  if (experiment.arms.filter(arm => arm.kind === 'variant').length >= 3) return null
  return <Button aria-disabled={writes.busy || undefined} onClick={async () => {
    if (writes.busy) return
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
  const pending = useRef<{ started: boolean; cancelled: boolean } | null>(null)
  const [error, setError] = useState<string>()
  const [invalid, setInvalid] = useState(false)
  const [saved, setSaved] = useState(false)
  useEffect(() => { draft.current = arm.label; setName(arm.label) }, [arm.label])
  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(false), 2000)
    return () => clearTimeout(timer)
  }, [saved])
  async function commit() {
    if (!editable || pending.current || draft.current === arm.label) return
    if (!draft.current.trim()) { setInvalid(true); return }
    const label = draft.current.trim()
    const attempt = { started: false, cancelled: false }
    pending.current = attempt
    setError(undefined); setSaved(false)
    try {
      const result = await writes.write(arms => {
        if (!arms.some(current => current.key === arm.key)) throw new ArmWriteError(C.staleEdit)
        return arms.map(current => current.key === arm.key ? { ...current, label } : current)
      }, { onError: setError, queue: true, cancelled: () => attempt.cancelled, onStart: () => { attempt.started = true } })
      if (result) setSaved(true)
    } finally { pending.current = null }
  }
  return <div className="xp-slot-version-name"><TextInput id={id} label={C.name} aria-label={`${arm.label} ${C.name}`} value={name}
    readOnly={!editable || writes.busy} aria-disabled={writes.busy || undefined} error={invalid ? C.emptyLabel : error}
    onChange={event => { draft.current = event.target.value; setName(event.target.value); setInvalid(false); setError(undefined); setSaved(false) }}
    onBlur={() => void commit()} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); void commit() }
      if (event.key === 'Escape') { event.preventDefault(); if (pending.current?.started) return; if (pending.current) pending.current.cancelled = true; draft.current = arm.label; setName(arm.label); setInvalid(false); setError(undefined); setSaved(false) }
    }} />{saved ? <span role="status" className="xp-ui-help">{C.saved}</span> : null}</div>
}

export function RemoveVersion({ arm, writes, count, shared, onRemove, onClose }: {
  arm: EditorExperiment['arms'][number]; writes: ArmWrites; count: number; shared: boolean | undefined; onRemove: (slot: ArmSlot) => void; onClose: () => void
}) {
  const slot = arm.key === 'holdout' ? undefined : arm.key as ArmSlot
  const [tried, setTried] = useState(false)
  return <Dialog open title={C.removeTitle(arm.label)} initialFocus="cancel" dismissible={!writes.busy} onClose={() => onClose()}>
      <div className="xp-slot-drawer"><p>{C.removeHelp(count)}</p>{shared === undefined ? <p>{C.removeScopeUnknown}</p> : shared ? <p>{C.removeShared}</p> : null}
      {tried && writes.errorFor(`remove:${arm.key}`) ? <p role="alert" className="xp-ui-error">{writes.errorFor(`remove:${arm.key}`)}</p> : null}
      <div className="xp-ui-button-group">
        <Button data-dialog-cancel aria-disabled={writes.busy || undefined} onClick={() => { if (!writes.busy) onClose() }}>{C.cancel}</Button>
        <Button variant="danger" aria-busy={writes.busy || undefined} aria-disabled={writes.busy || undefined} onClick={async () => {
          if (writes.busy) return
          setTried(true)
          const saved = await writes.write(arms => splitEvenly(removeArm(arms, arm.key)), { errorKey: `remove:${arm.key}` })
          if (saved) { if (slot) onRemove(slot); onClose() }
        }}>{C.remove}</Button>
      </div></div>
    </Dialog>
}

export type WeightEdits = Partial<Record<ArmKey, string>>
export function VersionWeights({ experiment, writes, edits, setEdits, groupId, splitIntent, editable = true, beforeSplit, renderRow }: { experiment: EditorExperiment; writes: ArmWrites; edits: WeightEdits; setEdits: (edits: WeightEdits) => void; groupId: string; splitIntent: RefObject<boolean>; editable?: boolean; beforeSplit?: ReactNode; renderRow?: (arm: EditorExperiment['arms'][number], input: ReactNode) => ReactNode }) {
  const id = useId()
  const split = useRef<HTMLDivElement>(null)
  const [errors, setErrors] = useState<Partial<Record<ArmKey, string>>>({})
  const armKeys = experiment.arms.map(arm => arm.key).join(',')
  useEffect(() => {
    const keys = new Set(armKeys.split(','))
    setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => keys.has(key))))
  }, [armKeys])
  const clearErrors = (keys: ArmKey[]) => setErrors(current => Object.fromEntries(Object.entries(current).filter(([key]) => !keys.includes(key as ArmKey))))
  const invalidKeys = new Set(Object.entries(edits).filter(([, raw]) => raw.trim() === '' || !Number.isInteger(Number(raw)) || Number(raw) < 0 || Number(raw) > 100).map(([key]) => key))
  const apply = (arms: Arm[], key: ArmKey) => balanceWeight(arms, key, Number(edits[key]))
  const keys = Object.keys(edits) as ArmKey[]
  const clearDraft = (key: ArmKey) => setEdits(Object.fromEntries(Object.entries(edits).filter(([current]) => current !== key)))
  const live = withSlotsFor(keys.length === 1 && !invalidKeys.has(keys[0]!) && !errors[keys[0]!] ? apply(experiment.arms as Arm[], keys[0]!) : experiment.arms as Arm[], 'block')
  const issues = checkArms(live, 'block')
  async function commit(key: ArmKey) {
    if (writes.busy || edits[key] === undefined || invalidKeys.has(key)) return
    clearErrors([key])
    const saved = await writes.write(arms => apply(arms, key), { onError: message => setErrors(current => ({ ...current, [key]: message })) })
    if (saved) clearDraft(key)
  }
  return <div className="xp-slot-weights">
    <div className="xp-slot-weight-inputs">{experiment.arms.map(arm => { const input = <NumberInput id={`${id}-${arm.key}`} label={C.traffic} aria-label={C.weight(arm.label)}
      min={0} max={100} step={1} value={edits[arm.key] ?? live.find(current => current.key === arm.key)?.weight ?? ''} readOnly={!editable || writes.busy} aria-disabled={writes.busy || undefined}
      error={invalidKeys.has(arm.key) ? C.invalidShare : errors[arm.key]}
      onChange={event => { clearErrors([arm.key]); setEdits({ ...edits, [arm.key]: event.target.value }) }}
      onBlur={event => { const target = event.relatedTarget as Element | null; if (!splitIntent.current && !(typeof target?.closest === 'function' && target.closest('[data-xp-split]')?.getAttribute('data-xp-split') === groupId)) void commit(arm.key) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit(arm.key) } if (event.key === 'Escape' && !writes.busy) { event.preventDefault(); clearErrors([arm.key]); clearDraft(arm.key) } }} />; return <div key={arm.key}>{renderRow ? renderRow(arm, input) : input}</div> })}</div>
    {Object.keys(edits).length && !invalidKeys.size ? issues.map((issue, i) => <p role="alert" className="xp-ui-error" key={i}>{issueMessage(issue, totalWeight(live))}</p>) : null}
    {beforeSplit}
    {editable ? <div ref={split} data-xp-split={groupId} onPointerDownCapture={() => {
      // Pointer intent reaches the destination before the source iframe loses focus.
      splitIntent.current = true
      setTimeout(() => { splitIntent.current = false }, 0)
    }}><Button variant="quiet" size="sm" aria-disabled={writes.busy || undefined} onClick={async () => { if (writes.busy) return; const saved = await writes.write(splitEvenly, { errorKey: 'split' }); if (saved) setEdits({}) }}>{C.split}</Button></div> : null}
  </div>
}

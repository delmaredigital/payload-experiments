'use client'
import { createContext, useContext, useEffect, useId, useRef, useState, type Dispatch, type ReactNode, type RefObject, type SetStateAction } from 'react'
import { balanceWeight, splitEvenly, totalWeight, withSlotsFor } from '../../arms/model.js'
import { checkArms } from '../../collections/experiments/armInvariants.js'
import { issueMessage } from '../../arms/copy.js'
import type { Arm, ArmKey } from '../../types/contracts.js'
import type { ArmSlot } from '../../types/puck.js'
import { Button } from '../../ui/Button.js'
import { Dialog } from '../../ui/Dialog.js'
import { NumberInput, TextInput } from '../../ui/Inputs.js'
import type { EditorExperiment } from './editor.model.js'
import { addVersionArms, ArmWriteError, removeVersionArms, renameVersionArms, setVersionTraffic, writeArms } from './armWrites.js'
import { editorCopy as C } from './copy.js'

const VersionLockContext = createContext<string | undefined>(undefined)

/** A pointer shortcut supplements the explicit, keyboard-accessible open marker. */
export function VersionCard({ label, openLabel = label, active, dragging, onSelect, children }: {
  label: string; openLabel?: string; active: boolean; dragging: boolean; onSelect: () => void; children: ReactNode
}) {
  return <div className="xp-slot-version-group" data-active={active} role="group" aria-label={label} aria-current={active ? 'true' : undefined}
    onClick={event => {
      if (!dragging && !(event.target as Element).closest('button, input, label, select, textarea, a, [role="button"], [contenteditable="true"]')) onSelect()
    }}>
    <div className="xp-slot-version-row">
      <button type="button" className="xp-slot-version-open" aria-label={C.showVersion(openLabel)} aria-pressed={active} disabled={dragging} onClick={onSelect} />
      {children}
    </div>
  </div>
}

/** Keep unavailable controls reachable, and explain an attempted edit in place. */
export function VersionLock({ message, children }: { message?: string; children: (noticeId?: string) => ReactNode }) {
  const id = useId()
  const notice = useRef<HTMLDivElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const [attention, setAttention] = useState(false)
  useEffect(() => {
    setAttention(false)
    return () => { clearTimeout(timer.current); timer.current = undefined }
  }, [message])
  const explain = () => {
    if (timer.current !== undefined) return
    setAttention(true)
    notice.current?.scrollIntoView?.({ block: 'nearest' })
    timer.current = setTimeout(() => { timer.current = undefined; setAttention(false) }, 2000)
  }
  return <VersionLockContext.Provider value={message ? id : undefined}>
    <div className="xp-slot-version-controls" onClickCapture={event => {
      if (message && (event.target as Element).closest('[aria-disabled="true"]')) {
        event.preventDefault(); event.stopPropagation(); explain()
      }
    }} onKeyDownCapture={event => {
      // Leave Tab, caret navigation and copying available on read-only values.
      const control = (event.target as Element).closest('[aria-disabled="true"]')
      const stepping = control?.matches('input[type="number"]') && ['ArrowUp', 'ArrowDown'].includes(event.key)
      if (message && control && !event.ctrlKey && !event.metaKey && !event.altKey &&
        (event.key.length === 1 || ['Enter', 'Backspace', 'Delete'].includes(event.key) || stepping)) {
        event.preventDefault(); event.stopPropagation(); explain()
      }
    }}>
      {message ? <div ref={notice} id={id} className="xp-slot-lock-notice" data-attention={attention}>
        {attention ? <span key="attention" role="alert">{message}</span> : <span key="rest">{message}</span>}
      </div> : null}
      {children(message ? id : undefined)}
    </div>
  </VersionLockContext.Provider>
}

export function useArmWrites({ url, bindingKey, status, controlKeys, publish, isCurrent, onWrite, onSaved }: {
  url: string; bindingKey: string; status?: EditorExperiment['status']; controlKeys: string[]
  publish: (doc: EditorExperiment) => EditorExperiment | void; isCurrent: () => boolean; onWrite: () => void; onSaved?: () => void
}) {
  const guard = useRef(false)
  const running = useRef<Promise<void>>(Promise.resolve())
  const [busy, setBusy] = useState(false)
  type Refusal = { message: string; status: typeof status }
  const [errorState, setErrors] = useState<{ bindingKey: string; errors: Record<string, Refusal> }>({ bindingKey, errors: {} })
  const errors: Record<string, Refusal> = errorState.bindingKey === bindingKey ? errorState.errors : {}
  const controls = controlKeys.join(',')
  const scope = useRef({ bindingKey, status, keys: new Set(controlKeys) })
  scope.current = { bindingKey, status, keys: new Set(controlKeys) }
  useEffect(() => {
    const keys = new Set(controls.split(','))
    setErrors(current => ({ bindingKey, errors: current.bindingKey === bindingKey
      ? Object.fromEntries(Object.entries(current.errors).filter(([key, refusal]) => keys.has(key) &&
        (key !== 'split' && key !== 'add' || refusal.status === status))) : {} }))
  }, [bindingKey, controls, status])
  const clearError = (key: string) => setErrors(current => {
    if (current.bindingKey !== bindingKey) return current
    const next = { ...current.errors }; delete next[key]; return { bindingKey, errors: next }
  })
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
    try { const saved = await writeArms(url, transform, doc => {
      // Publishing and refusing can finish in one React batch. Remember the fresh
      // status now so the lock change that caused this refusal does not erase it.
      const accepted = publish(doc) ?? doc
      if (scope.current.bindingKey === bindingKey) scope.current.status = accepted.status
      return accepted
    }, options); if (isCurrent()) setErrors({ bindingKey, errors: {} }); onSaved?.(); return saved }
    catch (error) { if (isCurrent()) { const message = error instanceof ArmWriteError ? error.message : C.writeNetwork; if (options?.onError) options.onError(message); else if (scope.current.bindingKey === bindingKey && scope.current.keys.has(errorKey)) {
      const refusal = { message, status: scope.current.status }
      setErrors(current => ({ bindingKey, errors: { ...(current.bindingKey === bindingKey ? current.errors : {}), [errorKey]: refusal } }))
    } } }
    finally { guard.current = false; setBusy(false); release() }
  }
  return { write, busy, error: Object.entries(errors).filter(([key]) => !key.startsWith('remove:')).map(([, refusal]) => refusal.message).join(' '), errorFor: (key: string) => errors[key]?.message, clearError }
}
export type ArmWrites = ReturnType<typeof useArmWrites>

export function AddVariant({ experiment, writes, onSelect }: { experiment: EditorExperiment; writes: ArmWrites; onSelect: (slot: ArmSlot) => void }) {
  if (experiment.arms.filter(arm => arm.kind === 'variant').length >= 3) return null
  return <Button size="sm" aria-disabled={writes.busy || undefined} onClick={async () => {
    if (writes.busy) return
    let added: ArmSlot | undefined
    const saved = await writes.write(arms => {
      const next = addVersionArms(arms)
      added = next.find(arm => !arms.some(existing => existing.key === arm.key))?.key as ArmSlot | undefined
      return next
    })
    if (saved && added) onSelect(added)
  }}>{C.add}</Button>
}

/** Always-visible editor for the saved version name. */
export function VersionName({ arm, writes, editable }: { arm: EditorExperiment['arms'][number]; writes: ArmWrites; editable: boolean }) {
  const id = useId()
  const lockId = useContext(VersionLockContext)
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
      const result = await writes.write(arms => renameVersionArms(arms, arm.key, label), { onError: setError, queue: true, cancelled: () => attempt.cancelled, onStart: () => { attempt.started = true } })
      if (result) setSaved(true)
    } finally { pending.current = null }
  }
  const message = invalid ? C.emptyLabel : error
  return <div className="xp-slot-version-name"><TextInput id={id} label={C.name} aria-label={`${arm.label} ${C.name}`} value={name}
    readOnly={!editable || writes.busy} aria-disabled={!editable || writes.busy || undefined} aria-describedby={[lockId, saved ? `${id}-saved` : undefined].filter(Boolean).join(' ') || undefined} aria-errormessage={message ? `${id}-error` : undefined} error={message}
    onChange={event => { if (!editable || writes.busy) return; draft.current = event.target.value; setName(event.target.value); setInvalid(false); setError(undefined); setSaved(false) }}
    onBlur={() => void commit()} onKeyDown={event => {
      if (event.key === 'Enter') { event.preventDefault(); void commit() }
      if (event.key === 'Escape') { event.preventDefault(); if (pending.current?.started) return; if (pending.current) pending.current.cancelled = true; draft.current = arm.label; setName(arm.label); setInvalid(false); setError(undefined); setSaved(false) }
    }} /><span id={`${id}-saved`} role={saved ? 'status' : undefined} aria-hidden={!saved} className="xp-ui-help xp-slot-version-saved">{C.saved}</span></div>
}

export function RemoveVersion({ arm, writes, count, shared, onRemove, onClose }: {
  arm: EditorExperiment['arms'][number]; writes: ArmWrites; count: number; shared: boolean | undefined; onRemove: (slot: ArmSlot) => void; onClose: () => void
}) {
  const slot = arm.key === 'holdout' ? undefined : arm.key as ArmSlot
  const close = () => { writes.clearError(`remove:${arm.key}`); onClose() }
  return <Dialog open title={C.removeTitle(arm.label)} initialFocus="cancel" dismissible={!writes.busy} onClose={close}>
      <div className="xp-slot-drawer"><p>{C.removeHelp(count)}</p>{shared === undefined ? <p>{C.removeScopeUnknown}</p> : shared ? <p>{C.removeShared}</p> : null}
      {writes.errorFor(`remove:${arm.key}`) ? <p role="alert" className="xp-ui-error">{writes.errorFor(`remove:${arm.key}`)}</p> : null}
      <div className="xp-ui-button-group">
        <Button data-dialog-cancel aria-disabled={writes.busy || undefined} onClick={() => { if (!writes.busy) close() }}>{C.cancel}</Button>
        <Button variant="danger" aria-busy={writes.busy || undefined} aria-disabled={writes.busy || undefined} onClick={async () => {
          if (writes.busy) return
          const saved = await writes.write(arms => removeVersionArms(arms, arm.key), { errorKey: `remove:${arm.key}` })
          if (saved) { if (slot) onRemove(slot); close() }
        }}>{C.remove}</Button>
      </div></div>
    </Dialog>
}

export type WeightEdits = Partial<Record<ArmKey, string>>
export function VersionWeights({ experiment, writes, edits, setEdits, groupId, splitIntent, editable = true, showSplit = editable, beforeSplit, beforeActions, renderRow }: { experiment: EditorExperiment; writes: ArmWrites; edits: WeightEdits; setEdits: Dispatch<SetStateAction<WeightEdits>>; groupId: string; splitIntent: RefObject<boolean>; editable?: boolean; showSplit?: boolean; beforeSplit?: ReactNode; beforeActions?: ReactNode; renderRow?: (arm: EditorExperiment['arms'][number], input: ReactNode) => ReactNode }) {
  const id = useId()
  const lockId = useContext(VersionLockContext)
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
  const clearDraft = (key: ArmKey) => setEdits(current => Object.fromEntries(Object.entries(current).filter(([candidate]) => candidate !== key)))
  const live = withSlotsFor(keys.length === 1 && !invalidKeys.has(keys[0]!) && !errors[keys[0]!] ? apply(experiment.arms as Arm[], keys[0]!) : experiment.arms as Arm[], 'block')
  const issues = checkArms(live, 'block')
  async function commit(key: ArmKey) {
    if (!editable || writes.busy || edits[key] === undefined || invalidKeys.has(key)) return
    clearErrors([key])
    const saved = await writes.write(arms => setVersionTraffic(arms, key, Number(edits[key])), { onError: message => setErrors(current => ({ ...current, [key]: message })) })
    if (saved) clearDraft(key)
  }
  return <div className="xp-slot-weights">
    <div className="xp-slot-weight-inputs">{experiment.arms.map(arm => { const input = <NumberInput id={`${id}-${arm.key}`} label={C.traffic} aria-label={C.weight(arm.label)}
      min={0} max={100} step={1} value={edits[arm.key] ?? live.find(current => current.key === arm.key)?.weight ?? ''} readOnly={!editable || writes.busy} aria-disabled={!editable || writes.busy || undefined} aria-describedby={lockId}
      error={invalidKeys.has(arm.key) ? C.invalidShare : errors[arm.key]} aria-errormessage={invalidKeys.has(arm.key) || errors[arm.key] ? `${id}-${arm.key}-error` : undefined}
      onChange={event => { if (!editable || writes.busy) return; clearErrors([arm.key]); const value = event.target.value; setEdits(current => ({ ...current, [arm.key]: value })) }}
      onBlur={event => { const target = event.relatedTarget as Element | null; if (!splitIntent.current && !(typeof target?.closest === 'function' && target.closest('[data-xp-split]')?.getAttribute('data-xp-split') === groupId)) void commit(arm.key) }} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void commit(arm.key) } if (event.key === 'Escape' && !writes.busy) { event.preventDefault(); clearErrors([arm.key]); clearDraft(arm.key) } }} />; return <div key={arm.key} className="xp-slot-version-item">{renderRow ? renderRow(arm, <div className="xp-slot-version-traffic">{input}<span className="xp-slot-percent" aria-hidden="true">{C.percent}</span></div>) : input}</div> })}</div>
    {Object.keys(edits).length && !invalidKeys.size ? issues.map((issue, i) => <p role="alert" className="xp-ui-error" key={i}>{issueMessage(issue, totalWeight(live))}</p>) : null}
    {beforeActions}
    {beforeSplit || showSplit ? <div className="xp-slot-version-actions">{beforeSplit}
    {showSplit ? <div data-xp-split={groupId} onPointerDownCapture={() => {
      // Pointer intent reaches the destination before the source iframe loses focus.
      if (!editable) return
      splitIntent.current = true
      setTimeout(() => { splitIntent.current = false }, 0)
    }}><Button size="sm" aria-describedby={lockId} aria-disabled={!editable || writes.busy || undefined} onClick={async () => { if (!editable || writes.busy) return; const saved = await writes.write(splitEvenly, { errorKey: 'split' }); if (saved) { setEdits(() => ({})); setErrors({}) } }}>{C.split}</Button></div> : null}</div> : null}
  </div>
}

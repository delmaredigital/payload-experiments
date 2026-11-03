'use client'

import { useId, useRef, useState } from 'react'
import type { ExperimentRef } from '../../types/puck.js'
import { CreateRefused, createTest } from './createTest.js'
import { editorCopy } from './copy.js'
import './editor.css'

export function CreateExperimentDrawer({ onCreate, onClose, initialName = '' }: {
  initialName?: string
  onCreate: (experiment: ExperimentRef) => void
  onClose: () => void
}) {
  const titleId = useId()
  const nameId = useId()
  const [name, setName] = useState(initialName)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  async function submitNew() {
    if (inFlight.current || !name.trim()) return
    inFlight.current = true
    setPending(true)
    setError('')
    try {
      const experiment = await createTest('/api', { name, kind: 'block', unitType: 'visitor' })
      onCreate(experiment)
      onClose()
    } catch (cause) {
      setError(cause instanceof CreateRefused ? cause.message : editorCopy.createError)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <aside className="xp-slot-root xp-slot-drawer" role="dialog" aria-labelledby={titleId}>
    <h3 className="xp-slot-title" id={titleId}>{editorCopy.createLabel}</h3>
    <div className="xp-slot-field">
      <label className="xp-slot-label" htmlFor={nameId}>{editorCopy.name}</label>
      <input className="xp-slot-input" id={nameId} value={name} disabled={pending} onChange={event => setName(event.currentTarget.value)} />
    </div>
    {error ? <p className="xp-slot-error" role="alert">{error}</p> : null}
    <div className="xp-slot-actions">
      <button className="xp-slot-button xp-slot-button-primary" type="button" disabled={pending || !name.trim()} onClick={() => { void submitNew() }}>{pending ? editorCopy.creating : editorCopy.createLabel}</button>
      <button className="xp-slot-button" type="button" disabled={pending} onClick={onClose}>{editorCopy.cancel}</button>
    </div>
  </aside>
}

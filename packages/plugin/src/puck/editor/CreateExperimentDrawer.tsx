'use client'

import { useId, useRef, useState } from 'react'
import type { ExperimentRef } from '../../types/puck.js'
import { CreateRefused, createTest } from './createTest.js'
import { editorCopy } from './copy.js'

export function CreateExperimentDrawer({ onCreate, onClose, initialName = '' }: {
  initialName?: string
  onCreate: (experiment: ExperimentRef) => void
  onClose: () => void
}) {
  const titleId = useId()
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

  return <aside role="dialog" aria-labelledby={titleId} style={{ padding: 16, border: '1px solid #aaa', background: 'Canvas', color: 'CanvasText' }}>
    <h3 id={titleId}>{editorCopy.createLabel}</h3>
    <label style={{ display: 'block', marginBottom: 8 }}>{editorCopy.name}
      <input value={name} disabled={pending} onChange={event => setName(event.currentTarget.value)} />
    </label>
    {error ? <p role="alert">{error}</p> : null}
    <button type="button" disabled={pending || !name.trim()} onClick={() => { void submitNew() }}>{pending ? editorCopy.creating : editorCopy.createLabel}</button>
    <button type="button" disabled={pending} onClick={onClose}>{editorCopy.cancel}</button>
  </aside>
}

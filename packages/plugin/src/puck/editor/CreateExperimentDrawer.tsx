'use client'

import { useId, useRef, useState } from 'react'
import { Dialog } from '../../ui/Dialog.js'
import { TextInput } from '../../ui/TextInput.js'
import { Button } from '../../ui/Button.js'
import { Banner } from '../../ui/Banner.js'
import { usePuckRoutes } from '../hostContext.js'
import type { ExperimentRef } from '../../types/puck.js'
import type { Arm } from '../../types/contracts.js'
import { CreateRefused, createTest } from './createTest.js'
import { editorCopy } from './copy.js'
import './editor.css'

export function CreateExperimentDrawer({ onCreate, onClose, initialName = '', arms, label = editorCopy.createLabel }: {
  initialName?: string
  arms?: Arm[] | (() => Promise<Arm[]>)
  label?: string
  onCreate: (experiment: ExperimentRef) => void
  onClose: () => void
}) {
  const { api } = usePuckRoutes()
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
      const versions = typeof arms === 'function' ? await arms() : arms
      const experiment = await createTest(api, { name, kind: 'block', unitType: 'visitor', arms: versions })
      onCreate(experiment)
      onClose()
    } catch (cause) {
      setError(cause instanceof CreateRefused ? cause.message : editorCopy.createError)
    } finally {
      inFlight.current = false
      setPending(false)
    }
  }

  return <Dialog open title={label} onClose={onClose} dismissible={!pending}>
    <div className="xp-slot-drawer">
      <TextInput id={nameId} label={editorCopy.name} value={name} disabled={pending} onChange={event => setName(event.currentTarget.value)} />
      {error ? <Banner tone="error">{error}</Banner> : null}
      <div className="xp-ui-button-group">
        <Button variant="primary" disabled={pending || !name.trim()} onClick={() => { void submitNew() }}>{pending ? editorCopy.creating : label}</Button>
        <Button disabled={pending} onClick={onClose}>{editorCopy.cancel}</Button>
      </div>
    </div>
  </Dialog>
}

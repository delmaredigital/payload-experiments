'use client'

import { useId, useRef, useState } from 'react'
import { Dialog } from '../../ui/Dialog.js'
import { TextInput } from '../../ui/TextInput.js'
import { Button } from '../../ui/Button.js'
import { Banner } from '../../ui/Banner.js'
import { PuckHostProvider, usePuckRoutes } from '../hostContext.js'
import { createRoot } from 'react-dom/client'
import type { resolvePuckRoutes } from '../routes.js'
import type { ExperimentRef } from '../../types/puck.js'
import type { Arm } from '../../types/contracts.js'
import { CreateRefused, createTest } from './createTest.js'
import { editorCopy } from './copy.js'
import { invalidatePlacements } from './placementsCache.js'
import './editor.css'

export function CreateExperimentDrawer({ onCreate, onClose, initialName = '', arms, label = editorCopy.createLabel, onPendingChange }: {
  initialName?: string
  arms?: Arm[] | (() => Promise<Arm[]>)
  label?: string
  onPendingChange?: (pending: boolean) => void
  onCreate: (experiment: ExperimentRef) => boolean
  onClose: () => void
}) {
  const { api, admin } = usePuckRoutes()
  const nameId = useId()
  const [name, setName] = useState(initialName)
  const inFlight = useRef(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [unbound, setUnbound] = useState<ExperimentRef>()

  async function submitNew() {
    if (inFlight.current || !name.trim()) return
    inFlight.current = true
    setPending(true)
    onPendingChange?.(true)
    setError('')
    try {
      const versions = typeof arms === 'function' ? await arms() : arms
      const experiment = await createTest(api, { name, kind: 'block', unitType: 'visitor', arms: versions })
      invalidatePlacements(api, experiment.id)
      if (onCreate(experiment)) onClose()
      else setUnbound(experiment)
    } catch (cause) {
      setError(cause instanceof CreateRefused ? cause.message : editorCopy.createError)
    } finally {
      inFlight.current = false
      setPending(false)
      onPendingChange?.(false)
    }
  }

  return <Dialog open title={label} onClose={onClose} dismissible={!pending}>
    <div className="xp-slot-drawer">
      {unbound ? <p>{editorCopy.createdUnbound}{' '}<a href={`${admin}/experiments/${encodeURIComponent(unbound.id)}`} target="_blank" rel="noopener noreferrer">{editorCopy.openTest}</a></p> : null}
      <TextInput id={nameId} label={editorCopy.name} value={name} disabled={pending} onChange={event => setName(event.currentTarget.value)} />
      {error ? <Banner tone="error">{error}</Banner> : null}
      {!name.trim() ? <p className="xp-ui-help">{editorCopy.enterName}</p> : null}
      <div className="xp-ui-button-group">
        <Button variant="primary" disabled={pending || !!unbound || !name.trim()} onClick={() => { void submitNew() }}>{pending ? editorCopy.creating : label}</Button>
        <Button disabled={pending} onClick={onClose}>{editorCopy.cancel}</Button>
      </div>
    </div>
  </Dialog>
}

/** The dialog belongs to the document so deleting its block during POST cannot hide the created test. */
export function openCreateExperimentDrawer(source: HTMLElement, routes: ReturnType<typeof resolvePuckRoutes>, props: Omit<Parameters<typeof CreateExperimentDrawer>[0], 'onClose' | 'onPendingChange'>) {
  const container = source.ownerDocument.createElement('div')
  container.className = 'xp-slot-dialog-host'
  const tokenRoot = source.ownerDocument.createElement('div')
  tokenRoot.className = 'xp-slot-root xp-slot-editor'
  tokenRoot.style.cssText = source.style.cssText
  container.append(tokenRoot)
  if (source.closest('[data-theme="dark"], .dark')) container.dataset.theme = 'dark'
  source.ownerDocument.body.append(container)
  const root = createRoot(tokenRoot)
  let pending = false, closed = false
  const close = () => {
    if (closed) return
    closed = true
    // Cleanup can originate from the creator's unmount commit.
    queueMicrotask(() => { root.unmount(); container.remove() })
  }
  root.render(<PuckHostProvider routes={routes}><div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()}>
    <CreateExperimentDrawer {...props} onPendingChange={value => { pending = value }} onClose={close} />
  </div></PuckHostProvider>)
  return { closeIfIdle: () => { if (!pending) close() } }
}

'use client'
import { useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerOverlayPortal } from '@puckeditor/core'
import type { DocId } from '../../types/contracts.js'
import { TestSurface } from '../../testSurface/surface/test/TestSurface.js'
import { Drawer } from '../../ui/Drawer.js'
import { Button } from '../../ui/Button.js'
import { TEST_PAGE } from '../../testSurface/copy/testPage.js'
import { readSurface, useEditorSurface, type SurfaceState } from './editorSurface.js'
import { editorCopy as C } from './copy.js'
import { publishExperiment } from './armsCache.js'
import { currentPuckDocument } from './editor.model.js'
import { publishPlacements } from './placementsCache.js'
import type { resolvePuckRoutes } from '../routes.js'
import './editor.css'

export function ConfigureTestDrawer({ id, routes, onClose }: {
  id: DocId; routes: ReturnType<typeof resolvePuckRoutes>; onClose: () => void
}) {
  const [title, setTitle] = useState(C.configure as string)
  const [state, setState] = useState<SurfaceState>({})
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    setState({})
    void readSurface(routes.api).then(result => {
      if (active) setState(result.surface ? { surface: { ...result.surface, adminRoute: routes.admin, apiRoute: routes.api } } : result)
    })
    return () => { active = false }
  }, [routes.api, routes.admin, attempt])
  // Unknown permissions use the test page's authoritative admin access check.
  const testUrl = `${routes.admin}/experiments/${encodeURIComponent(id)}`
  const openUrl = state.surface && !state.surface.canManage && state.surface.canReadResults ? `${testUrl}/results` : testUrl
  return <Drawer title={title} closeLabel={C.closeConfigure} onClose={onClose}
    actions={<Button variant={state.error === 'unavailable' ? 'primary' : 'link'} size="sm" href={openUrl} target="_blank" rel="noopener noreferrer">{C.openInTab}</Button>}>
    <div className="xp-configure-panel xp-test-surface" onClickCapture={event => {
      // Internal section jumps stay in the drawer; navigation never replaces the editor.
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
      if (link && !link.getAttribute('href')?.startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer' }
    }}>
      {state.surface ? <TestSurface id={id} surface={{ ...state.surface, editorPage: currentPuckDocument(window.location.pathname, routes.admin) }} embedded onTitleChange={setTitle}
        onDocument={doc => publishExperiment(id, doc)} onPreflight={preflight => publishPlacements(routes.api, id, preflight.checks.some(check => !check.ok && check.code === 'no-placements' && check.detail !== undefined) ? undefined : preflight.placements, preflight)} /> : <div role={state.error ? 'alert' : 'status'}><p>{state.error === 'forbidden' ? TEST_PAGE.forbidden : state.error ? C.setupUnavailable : TEST_PAGE.loading}</p>{state.error === 'unavailable' ? <Button onClick={() => setAttempt(value => value + 1)}>{C.retrySetup}</Button> : null}</div>}
    </div>
  </Drawer>
}

/** Separate document root, like the creation dialog: Puck has no ancestor handlers here. */
export function openConfigureTestDrawer(source: HTMLElement, routes: ReturnType<typeof resolvePuckRoutes>, id: DocId) {
  // A canvas iframe's modal would cover only the canvas. Mount over the whole editor.
  const doc = source.ownerDocument.defaultView?.frameElement?.ownerDocument ?? source.ownerDocument
  const container = doc.createElement('div')
  container.className = 'xp-slot-root xp-slot-editor xp-configure-host'
  const themeSource = source.closest<HTMLElement>('.xp-slot-root') ?? source
  container.style.cssText = themeSource.style.cssText
  if (source.closest('[data-theme="dark"], .dark')) container.dataset.theme = 'dark'
  doc.body.append(container)
  const release = registerOverlayPortal(container, { disableDrag: true })
  const root = createRoot(container)
  let closed = false
  const close = () => {
    if (closed) return
    closed = true
    queueMicrotask(() => { root.unmount(); release?.(); container.remove(); if (source.isConnected) source.focus() })
  }
  root.render(<div onClick={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onPointerMove={event => event.stopPropagation()} onPointerUp={event => event.stopPropagation()}>
    <ConfigureTestDrawer id={id} routes={routes} onClose={close} />
  </div>)
  return { close }
}

/** The canvas already has current permissions; use them without a second read. */
export function ConfigureTestControl({ id, routes }: { id: DocId; routes: ReturnType<typeof resolvePuckRoutes> }) {
  const drawer = useRef<ReturnType<typeof openConfigureTestDrawer>>(undefined)
  useEffect(() => () => drawer.current?.close(), [id, routes.api])
  return <Button variant="primary" onClick={event => { drawer.current?.close(); drawer.current = openConfigureTestDrawer(event.currentTarget, routes, id) }}>{C.configure}</Button>
}
export function ConfigureTestButton({ id, routes }: { id: DocId; routes: ReturnType<typeof resolvePuckRoutes> }) {
  const access = useEditorSurface(routes.api)
  if (!access.surface || !access.surface.canManage && !access.surface.canReadResults) return null
  return <ConfigureTestControl id={id} routes={routes} />
}

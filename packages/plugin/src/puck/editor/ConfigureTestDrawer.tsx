'use client'
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { registerOverlayPortal } from '@puckeditor/core'
import type { DocId } from '../../types/contracts.js'
import type { SurfaceProps } from '../../testSurface/surface/contracts.js'
import { TestSurface } from '../../testSurface/surface/test/TestSurface.js'
import { Drawer } from '../../ui/Drawer.js'
import { Button } from '../../ui/Button.js'
import { editorCopy as C } from './copy.js'
import { publishExperiment } from './armsCache.js'
import { publishPlacements } from './placementsCache.js'
import type { resolvePuckRoutes } from '../routes.js'
import './editor.css'

/** The host supplies the same serialised permissions/configuration as the admin mount. */
export type { EditorTestSurface } from '../../testSurface/surface/contracts.js'
import type { EditorTestSurface } from '../../testSurface/surface/contracts.js'
const EditorSurfaceContext = createContext<EditorTestSurface | undefined>(undefined)
export function ExperimentsEditorProvider({ surface, children }: { surface: EditorTestSurface; children: ReactNode }) {
  return <EditorSurfaceContext.Provider value={surface}>{children}</EditorSurfaceContext.Provider>
}

export function ConfigureTestDrawer({ id, routes, surface, onClose }: {
  id: DocId; routes: ReturnType<typeof resolvePuckRoutes>; surface?: EditorTestSurface; onClose: () => void
}) {
  const [title, setTitle] = useState(C.configure as string)
  const context: SurfaceProps = { canManage: false, canReadResults: true, isAdmin: false,
    flagPoints: [], attributeKeys: {}, metricSources: [], ...surface, adminRoute: routes.admin, apiRoute: routes.api }
  return <Drawer title={title} closeLabel={C.closeConfigure} onClose={onClose}
    actions={<Button variant="link" size="sm" href={`${routes.admin}/experiments/${encodeURIComponent(id)}`} target="_blank" rel="noopener noreferrer">{C.openInTab}</Button>}>
    <div className="xp-configure-panel xp-test-surface" onClickCapture={event => {
      // Internal section jumps stay in the drawer; navigation never replaces the editor.
      const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]')
      if (link && !link.getAttribute('href')?.startsWith('#')) { link.target = '_blank'; link.rel = 'noopener noreferrer' }
    }}>
      <TestSurface id={id} surface={context} embedded onTitleChange={setTitle}
        onDocument={doc => publishExperiment(id, doc)} onPreflight={preflight => publishPlacements(routes.api, id, preflight.placements)} />
    </div>
  </Drawer>
}

/** Separate document root, like the creation dialog: Puck has no ancestor handlers here. */
export function openConfigureTestDrawer(source: HTMLElement, routes: ReturnType<typeof resolvePuckRoutes>, id: DocId, surface?: EditorTestSurface) {
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
    <ConfigureTestDrawer id={id} routes={routes} surface={surface} onClose={close} />
  </div>)
  return { close }
}

export function ConfigureTestButton({ id, routes, surface }: { id: DocId; routes: ReturnType<typeof resolvePuckRoutes>; surface?: EditorTestSurface }) {
  const inherited = useContext(EditorSurfaceContext)
  const context = surface ?? inherited
  const drawer = useRef<ReturnType<typeof openConfigureTestDrawer>>(undefined)
  useEffect(() => () => drawer.current?.close(), [id, routes.api])
  return <Button variant="primary" onClick={event => { drawer.current?.close(); drawer.current = openConfigureTestDrawer(event.currentTarget, routes, id, context) }}>{C.configure}</Button>
}

'use client'
import type { DocId } from '../../../types/contracts.js'
import type { SurfaceProps } from '../../../testSurface/surface/contracts.js'
import { TestSurface } from '../../../testSurface/surface/test/TestSurface.js'
import { TEST_PAGE as C } from '../../../testSurface/copy/testPage.js'
import { formatAdminURL } from '../../../testSurface/format/adminURL.js'
import { surfaceUrls } from '../../../testSurface/surfaceUrls.js'
import { Button } from '../../../ui/Button.js'
import { StatusChip } from '../../../ui/StatusChip.js'
import { SurfaceShell } from '../SurfaceShell.js'

export function TestPage({ id, surface, onTitleChange }: { id: DocId; surface: SurfaceProps; onTitleChange?: (title: string) => void }) {
  return <TestSurface id={id} surface={surface} onTitleChange={onTitleChange} renderFrame={({ test, children }) => {
    const doc = test.doc
    return <SurfaceShell adminRoute={surface.adminRoute} title={doc?.name ?? C.test}
      crumbs={[{ label: C.tests, href: surfaceUrls.home(surface.adminRoute) }, { label: doc?.name ?? C.test }]}
      status={doc ? <><span className="xp-tests-kind">{C.kinds[doc.kind]}</span><StatusChip status={doc.status} /></> : undefined}
      actions={doc && surface.canReadResults && ['running', 'stopped', 'decided'].includes(doc.status)
        ? <Button variant="secondary" href={formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/${encodeURIComponent(String(doc.id))}/results` })}>{C.results}</Button> : undefined}>
      {children}
    </SurfaceShell>
  }} />
}

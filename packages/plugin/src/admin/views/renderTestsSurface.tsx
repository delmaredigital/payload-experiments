import type { PayloadRequest } from 'payload'
import { RenderServerComponent } from '@payloadcms/ui/elements/RenderServerComponent'
import { accentStyles } from '../../ui/accent.js'
import { xpOptionsFromReq } from '../../options/fromReq.js'
import type { TestsSurfaceProps } from '../../types/surface.js'
import { XP_TESTS_SURFACE } from '../paths.js'
import { SURFACE_COPY } from '../../testSurface/copy/surface.js'

export async function renderTestsSurface(req: PayloadRequest, clientProps: TestsSurfaceProps | null) {
  // Keep the server export importable in plain Node; Next loads the CSS-bearing client boundary on render.
  const { RootViewMessage } = await import('../components/RootViewMessage.js')
  if (!clientProps) return <RootViewMessage>{SURFACE_COPY.noAccess}</RootViewMessage>
  function TestsSurfaceFallback() {
    return <RootViewMessage alert>{SURFACE_COPY.notInstalled}</RootViewMessage>
  }
  const css = accentStyles(xpOptionsFromReq(req).theme?.accent)
  const surface = RenderServerComponent({ Component: XP_TESTS_SURFACE, Fallback: TestsSurfaceFallback, importMap: req.payload.importMap, clientProps })
  return css ? <><style>{css}</style>{surface}</> : surface
}

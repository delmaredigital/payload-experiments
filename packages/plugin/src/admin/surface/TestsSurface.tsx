'use client'

import type { TestsSurfaceProps } from '../../types/surface.js'
import { SURFACE_COPY } from '../copy/surface.js'
import { SurfaceShell } from './SurfaceShell.js'
import { TestsHome } from './TestsHome.js'

export function TestsSurface(props: TestsSurfaceProps) {
  return <SurfaceShell adminRoute={props.adminRoute}>
    {props.route === 'home' ? <TestsHome adminRoute={props.adminRoute} apiRoute={props.apiRoute} />
      : props.route === 'new' ? <NewTestPlaceholder />
        : props.route === 'test' ? <TestPagePlaceholder /> : <ResultsPlaceholder />}
  </SurfaceShell>
}
function NewTestPlaceholder() { return <p>{SURFACE_COPY.newPlaceholder}</p> }
function TestPagePlaceholder() { return <p>{SURFACE_COPY.testPlaceholder}</p> }
function ResultsPlaceholder() { return <p>{SURFACE_COPY.resultsPlaceholder}</p> }

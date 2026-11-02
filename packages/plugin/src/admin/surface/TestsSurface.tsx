'use client'

import type { TestsSurfaceProps } from '../../types/surface.js'
import type { SurfaceProps } from './contracts.js'
import { NewTest } from './newTest/NewTest.js'
import { TestPage } from './test/TestPage.js'
import { ResultsRoute } from './ResultsRoute.js'
import { SurfaceShell } from './SurfaceShell.js'
import { TestsHome } from './TestsHome.js'

export function TestsSurface(props: TestsSurfaceProps) {
  const surface: SurfaceProps = {
    adminRoute: props.adminRoute, apiRoute: props.apiRoute, canManage: props.canManage,
    canReadResults: props.canReadResults, isAdmin: props.isAdmin, flagPoints: props.flagPoints,
    attributeKeys: props.attributeKeys, metricSources: props.metricSources,
    descriptions: props.admin?.descriptions,
  }
  return <SurfaceShell adminRoute={props.adminRoute}>
    {props.route === 'home' ? <TestsHome adminRoute={props.adminRoute} apiRoute={props.apiRoute} />
      : props.route === 'new' ? <NewTest surface={surface} pages={props.pages} />
        : props.id === undefined ? null : props.route === 'test' ? <TestPage key={props.id} id={props.id} surface={surface} />
          : <ResultsRoute key={props.id} id={props.id} surface={surface} />}
  </SurfaceShell>
}

'use client'

import { formatAdminURL } from 'payload/shared'
import type { TestsSurfaceProps } from '../../types/surface.js'
import { SURFACE_COPY } from '../copy/surface.js'
import { GOALS_COPY } from '../copy/goals.js'
import type { SurfaceProps } from './contracts.js'
import { NewTest } from './newTest/NewTest.js'
import { TestPage } from './test/TestPage.js'
import { ResultsRoute } from './ResultsRoute.js'
import { SurfaceShell } from './SurfaceShell.js'
import { GoalForm } from './goals/GoalForm.js'
import { GoalsList } from './goals/GoalsList.js'
import { TestsHome } from './TestsHome.js'

export function TestsSurface(props: TestsSurfaceProps) {
  const surface: SurfaceProps = {
    adminRoute: props.adminRoute, apiRoute: props.apiRoute, canManage: props.canManage,
    canReadResults: props.canReadResults, isAdmin: props.isAdmin, flagPoints: props.flagPoints,
    attributeKeys: props.attributeKeys, metricSources: props.metricSources,
    descriptions: props.admin?.descriptions,
  }
  const crumbs: Array<{ label: string; href?: string }> = [{ label: SURFACE_COPY.title }]
  if (props.route !== 'home') {
    crumbs[0]!.href = formatAdminURL({ adminRoute: props.adminRoute, path: '/experiments' })
    // Names load inside the page components; keep these crumbs route-based.
    if (props.route === 'goals' || props.route === 'goal' || props.route === 'goalNew') {
      crumbs.push({ label: GOALS_COPY.title })
      if (props.route === 'goalNew') {
        const returnQuery = props.returnToTest ? `?${new URLSearchParams({ return: props.returnToTest })}` : ''
        crumbs[1]!.href = formatAdminURL({ adminRoute: props.adminRoute, path: `/experiments/goals${returnQuery}` })
        crumbs.push({ label: GOALS_COPY.newGoal })
      }
    } else crumbs.push({ label: props.route === 'new' ? SURFACE_COPY.newTest : props.route === 'results' ? 'Results' : 'Test' })
  }
  if (props.route === 'home') return <TestsHome adminRoute={props.adminRoute} apiRoute={props.apiRoute} canManage={props.canManage} crumbs={crumbs} />
  return <SurfaceShell adminRoute={props.adminRoute} crumbs={crumbs}>
    {props.route === 'goals' ? <GoalsList surface={surface} returnToTest={props.returnToTest} />
        : props.route === 'goalNew' || props.route === 'goal' ? <GoalForm key={props.route === 'goalNew' ? 'new' : props.id} surface={surface} id={props.route === 'goal' ? props.id : undefined} returnToTest={props.returnToTest} />
      : props.route === 'new' ? <NewTest surface={surface} pages={props.pages} />
        : props.id === undefined ? null : props.route === 'test' ? <TestPage key={props.id} id={props.id} surface={surface} />
          : <ResultsRoute key={props.id} id={props.id} surface={surface} />}
  </SurfaceShell>
}

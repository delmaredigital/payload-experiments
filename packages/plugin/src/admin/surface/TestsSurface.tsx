'use client'

import { useState } from 'react'
import { formatAdminURL } from 'payload/shared'
import type { TestsSurfaceProps } from '../../types/surface.js'
import { SURFACE_COPY } from '../copy/surface.js'
import type { SurfaceProps } from './contracts.js'
import { NewTest } from './newTest/NewTest.js'
import { TestPage } from './test/TestPage.js'
import { ResultsRoute } from './ResultsRoute.js'
import { SurfaceShell } from './SurfaceShell.js'
import { GoalForm } from './goals/GoalForm.js'
import { GoalsList } from './goals/GoalsList.js'
import { TestsHome } from './TestsHome.js'

export function TestsSurface(props: TestsSurfaceProps) {
  // Reset loaded names when navigation selects another page or document.
  return <SurfacePage key={`${props.route}/${props.id ?? ''}`} {...props} />
}

function SurfacePage(props: TestsSurfaceProps) {
  const [loadedTitle, setLoadedTitle] = useState<string>()
  const title = props.route === 'home' ? SURFACE_COPY.title
    : props.route === 'new' ? SURFACE_COPY.newTest : loadedTitle ?? SURFACE_COPY.test
  const surface: SurfaceProps = {
    adminRoute: props.adminRoute, apiRoute: props.apiRoute, canManage: props.canManage,
    canReadResults: props.canReadResults, isAdmin: props.isAdmin, flagPoints: props.flagPoints,
    attributeKeys: props.attributeKeys, metricSources: props.metricSources,
    admin: props.admin, pageCollections: props.pageCollections,
    collectionTitles: props.collectionTitles, userId: props.userId, userCollection: props.userCollection,
  }
  const crumbs: Array<{ label: string; href?: string }> = [{ label: SURFACE_COPY.title }]
  if (props.route !== 'home') {
    crumbs[0]!.href = formatAdminURL({ adminRoute: props.adminRoute, path: '/experiments' })
    crumbs.push({ label: props.route === 'new' ? SURFACE_COPY.newTest : props.route === 'results' ? SURFACE_COPY.resultsTitle : SURFACE_COPY.test })
  }
  if (props.route === 'home') return <TestsHome adminRoute={props.adminRoute} apiRoute={props.apiRoute} canManage={props.canManage} flagPoints={props.flagPoints} crumbs={crumbs} />
  if (props.route === 'test' && props.id !== undefined) return <TestPage key={props.id} id={props.id} surface={surface} />
  if (props.route === 'goals') return <GoalsList surface={surface} returnToTest={props.returnToTest} />
  if (props.route === 'goalNew' || props.route === 'goal') return <GoalForm key={props.route === 'goalNew' ? 'new' : props.id} surface={surface} id={props.route === 'goal' ? props.id : undefined} returnToTest={props.returnToTest} />
  if (props.route === 'results' && props.id !== undefined) return <ResultsRoute key={props.id} id={props.id} surface={surface} onTitleChange={setLoadedTitle} />
  return <SurfaceShell adminRoute={props.adminRoute} crumbs={crumbs} title={title}>
    {props.route === 'new' ? <NewTest surface={surface} pages={props.pages} />
        : props.id === undefined ? null : <ResultsRoute key={props.id} id={props.id} surface={surface} onTitleChange={setLoadedTitle} />}
  </SurfaceShell>
}

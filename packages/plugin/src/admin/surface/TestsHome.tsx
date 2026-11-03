'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type { SummaryResponse } from '../../types/endpoints.js'
import { createApi } from '../api.js'
import { noMatchesLine, SURFACE_COPY } from '../copy/surface.js'
import { Banner, EmptyState, StatusChip } from '../../ui/Feedback.js'
import { Button } from '../../ui/Button.js'
import { SearchInput } from '../../ui/Inputs.js'
import { SurfaceShell } from './SurfaceShell.js'
import type { SurfaceShellProps } from './SurfaceShell.js'
import { groupTests, homeCard } from './home.model.js'
import type { HomeTest } from './home.model.js'

type State = { loading: true } | { loading: false; error: true } | {
  loading: false; error: false; tests: HomeTest[]; summaries: SummaryResponse; summaryError: boolean; limited: boolean
}
export function TestsHome({ adminRoute, apiRoute, canManage = false, crumbs }: {
  adminRoute: string; apiRoute: string; canManage?: boolean; crumbs?: SurfaceShellProps['crumbs']
}) {
  const api = useMemo(() => createApi(apiRoute), [apiRoute])
  const [state, setState] = useState<State>({ loading: true })
  const [search, setSearch] = useState('')
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const controller = new AbortController()
    setState({ loading: true })
    async function load() {
      try {
        const response = await fetch(`${apiRoute.replace(/\/$/, '')}/xp-experiments?depth=0&sort=-updatedAt&limit=200`, {
          credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) throw new Error('list')
        const { docs, totalDocs } = await response.json() as { docs: HomeTest[]; totalDocs: number }
        if (!active) return
        const summary = await api.summary(docs.map(doc => doc.id))
        if (active) setState({ loading: false, error: false, tests: docs, limited: totalDocs > docs.length,
          summaries: summary.ok ? summary.data ?? {} : {}, summaryError: !summary.ok })
      } catch {
        if (active) setState({ loading: false, error: true })
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [api, apiRoute, attempt])
  const retry = <Button size="sm" onClick={() => setAttempt(value => value + 1)}>{SURFACE_COPY.retry}</Button>
  const newTest = <Button variant="primary" href={formatAdminURL({ adminRoute, path: '/experiments/new' })}>{SURFACE_COPY.newTest}</Button>
  return <SurfaceShell adminRoute={adminRoute} crumbs={crumbs} actions={<>
    <div className="xp-tests-search">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="7" cy="7" r="4.5" /><path d="m10.5 10.5 3.5 3.5" /></svg>
      <SearchInput id="xp-tests-search" label={SURFACE_COPY.search} placeholder={SURFACE_COPY.search}
        value={search} onChange={event => setSearch(event.target.value)} />
    </div>
    {canManage ? <Button href={formatAdminURL({ adminRoute, path: '/experiments/goals' })}>{SURFACE_COPY.goals}</Button> : null}
    {newTest}
  </>}>
    {state.loading ? <p role="status">{SURFACE_COPY.loading}</p>
      : state.error ? <Banner tone="error" action={retry}>{SURFACE_COPY.loadError}</Banner>
        : <>
          {state.summaryError ? <Banner tone="error" action={retry}>{SURFACE_COPY.summaryError}</Banner> : null}
          {state.tests.length === 0 ? <EmptyState action={newTest}>{SURFACE_COPY.empty}</EmptyState>
            : <TestGroups tests={state.tests} summaries={state.summaries} adminRoute={adminRoute} search={search} clear={() => setSearch('')} />}
          {state.limited ? <p className="xp-tests-limited">{SURFACE_COPY.limitedList}</p> : null}
        </>}
  </SurfaceShell>
}
function TestGroups({ tests, summaries, adminRoute, search, clear }: {
  tests: HomeTest[]; summaries: SummaryResponse; adminRoute: string; search: string; clear: () => void
}) {
  const groups = groupTests(tests, summaries, search)
  if (!groups.some(group => group.tests.length)) return <div className="xp-tests-no-matches"><p>{noMatchesLine(search)}</p>
    <Button variant="quiet" size="sm" onClick={clear}>{SURFACE_COPY.clear}</Button></div>
  return <>{groups.map((group, index) => {
    if (!group.tests.length) return null
    const rows = <div className="xp-tests-list">{group.tests.map(test => {
      const card = homeCard(test, summaries[test.id], adminRoute)
      return <article className="xp-tests-row" key={test.id}>
        <div className="xp-tests-row-main">
          <div className="xp-tests-row-name"><Link href={card.href}>{test.name}</Link><span className="xp-tests-kind">{card.kind}</span>
            <span title={card.pill.tooltip}><StatusChip status={test.status} /></span>
          </div>
          <div className="xp-tests-row-line">
            {test.status === 'running' && card.health ? <span className={`xp-tests-health xp-tests-health--${card.health}`}>{SURFACE_COPY.health[card.health]}</span> : null}
            <span>{card.line}</span>
          </div>
        </div>
        <Button className="xp-tests-row-action" size="sm" href={card.href}>{card.action}</Button>
      </article>
    })}</div>
    const heading = <div className="xp-tests-group-head"><h2 id={`xp-tests-group-${index}`}>{group.label}</h2><span>{group.tests.length}</span></div>
    return index === 5 ? <details className="xp-tests-group" key={group.label}><summary>
      <h2 className="xp-tests-group-head">{group.label}<span>{group.tests.length}</span><span className="xp-tests-group-chevron" aria-hidden="true">›</span></h2>
    </summary>{rows}</details>
      : <section className="xp-tests-group" key={group.label} aria-labelledby={`xp-tests-group-${index}`}>{heading}{rows}</section>
  })}</>
}

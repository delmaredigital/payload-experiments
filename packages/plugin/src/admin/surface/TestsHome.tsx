'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type { SummaryResponse } from '../../types/endpoints.js'
import { fetchAllDocs } from '../../lib/fetchAllDocs.js'
import { createApi } from '../api.js'
import { noMatchesLine, SURFACE_COPY } from '../copy/surface.js'
import { Banner, EmptyState, StatusChip } from '../../ui/Feedback.js'
import { Button } from '../../ui/Button.js'
import { SearchInput } from '../../ui/Inputs.js'
import { SurfaceShell } from './SurfaceShell.js'
import type { SurfaceShellProps } from './SurfaceShell.js'
import { sanitizeReadinessDetail } from '../../sanitizeReadinessDetail.js'
import { groupTests, homeCard } from './home.model.js'
import type { HomeTest } from './home.model.js'
import type { ReadinessContext } from './readiness/readiness.model.js'

const HOME_FIELDS = ['name', 'kind', 'status', 'analysis', 'arms', 'decidedAt', 'decision', 'unitType', 'flagPoint', 'updatedAt'] as const
// Typecheck fails if HomeTest gains a field the list request does not select (Payload always returns id).
const homeFieldsComplete: Exclude<keyof HomeTest, 'id'> extends (typeof HOME_FIELDS)[number] ? true : never = true
void homeFieldsComplete
const HOME_SELECT = HOME_FIELDS.map(field => `select[${field}]=true`).join('&')

type State = { loading: true } | { loading: false; error: true } | {
  loading: false; error: false; tests: HomeTest[]; summaries: SummaryResponse; summaryError: boolean; goalNames: Record<string, string>
}
export function TestsHome({ adminRoute, apiRoute, canManage = false, crumbs, flagPoints }: {
  adminRoute: string; apiRoute: string; canManage?: boolean; crumbs?: SurfaceShellProps['crumbs']; flagPoints?: ReadinessContext['flagPoints']
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
        const response = await fetchAllDocs<HomeTest>(`${apiRoute.replace(/\/$/, '')}/xp-experiments?depth=0&sort=id&${HOME_SELECT}`, {
          credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) throw new Error('list')
        const docs = response.docs.sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0))
        if (!active) return
        const summary = await api.summary(docs.map(doc => doc.id))
        const summaries = summary.ok ? summary.data ?? {} : {}
        const ids = [...new Set(docs.flatMap(doc => {
          const item = summaries[doc.id]
          if (!canManage || !['draft', 'stopped'].includes(doc.status) || item?.ready === true || item?.next?.code !== 'goal-in-some-versions') return []
          const detail = sanitizeReadinessDetail(item.next.code, item.next.detail) as Array<{ metricId: string | number }> | undefined
          return detail?.map(row => String(row.metricId)) ?? []
        }))]
        const goalNames: Record<string, string> = {}
        if (ids.length) {
          try {
            const query = new URLSearchParams({ 'where[id][in]': ids.join(','), depth: '0', limit: String(ids.length) })
            const response = await fetch(`${apiRoute.replace(/\/$/, '')}/xp-metrics?${query}`, { credentials: 'include', signal: controller.signal })
            const body = response.ok ? await response.json() as { docs?: Array<{ id: string | number; name?: string }> } : undefined
            for (const goal of body?.docs ?? []) if (typeof goal.name === 'string' && goal.name.trim() && ids.includes(String(goal.id))) goalNames[String(goal.id)] = goal.name
          } catch { /* An unreadable goal keeps the neutral readiness sentence. */ }
        }
        if (active) setState({ loading: false, error: false, tests: docs, goalNames,
          summaries, summaryError: !summary.ok })
      } catch {
        if (active) setState({ loading: false, error: true })
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [api, apiRoute, attempt, canManage])
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
            : <TestGroups tests={state.tests} summaries={state.summaries} goalNames={state.goalNames} adminRoute={adminRoute} flagPoints={flagPoints} search={search} clear={() => setSearch('')} />}
        </>}
  </SurfaceShell>
}
function TestGroups({ tests, summaries, goalNames, adminRoute, flagPoints, search, clear }: {
  tests: HomeTest[]; summaries: SummaryResponse; goalNames: Record<string, string>; adminRoute: string; flagPoints?: ReadinessContext['flagPoints']; search: string; clear: () => void
}) {
  const groups = groupTests(tests, summaries, search)
  if (!groups.some(group => group.tests.length)) return <div className="xp-tests-no-matches"><p>{noMatchesLine(search)}</p>
    <Button variant="quiet" size="sm" onClick={clear}>{SURFACE_COPY.clear}</Button></div>
  return <>{groups.map((group, index) => {
    if (!group.tests.length) return null
    const rows = <div className="xp-tests-list">{group.tests.map(test => {
      const card = homeCard(test, summaries[test.id], adminRoute, flagPoints, goalNames)
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

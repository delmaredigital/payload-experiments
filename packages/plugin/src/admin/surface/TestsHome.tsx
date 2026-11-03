'use client'

import { useEffect, useMemo, useState } from 'react'
import { Link, Pill } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type { SummaryResponse } from '../../types/endpoints.js'
import { createApi } from '../api.js'
import { SURFACE_COPY } from '../copy/surface.js'
import { groupTests, homeCard } from './home.model.js'
import type { HomeTest } from './home.model.js'

type State = { loading: true } | { loading: false; error: true } | {
  loading: false; error: false; tests: HomeTest[]; summaries: SummaryResponse; summaryError: boolean; limited: boolean
}
export function TestsHome({ adminRoute, apiRoute }: { adminRoute: string; apiRoute: string }) {
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
  const retry = <button type="button" onClick={() => setAttempt(value => value + 1)}>{SURFACE_COPY.retry}</button>
  const newTest = <Link className="xp-tests-primary" href={formatAdminURL({ adminRoute, path: '/experiments/new' })}>{SURFACE_COPY.newTest}</Link>
  return <>
    <div className="xp-tests-toolbar">
      <h1>{SURFACE_COPY.title}</h1>
      <label>{SURFACE_COPY.search}<input type="search" value={search} onChange={event => setSearch(event.target.value)} /></label>
      {newTest}<Link href={formatAdminURL({ adminRoute, path: '/experiments/goals' })}>{SURFACE_COPY.goals}</Link>
    </div>
    {state.loading ? <p role="status">{SURFACE_COPY.loading}</p>
      : state.error ? <div role="alert">{SURFACE_COPY.loadError} {retry}</div>
        : <>
          {state.limited ? <p>{SURFACE_COPY.limitedList}</p> : null}
          {state.summaryError ? <div role="alert">{SURFACE_COPY.summaryError} {retry}</div> : null}
          {state.tests.length === 0 ? <div><p>{SURFACE_COPY.empty}</p>{newTest}</div>
            : <TestGroups tests={state.tests} summaries={state.summaries} adminRoute={adminRoute} search={search} />}
        </>}
  </>
}
function TestGroups({ tests, summaries, adminRoute, search }: {
  tests: HomeTest[]; summaries: SummaryResponse; adminRoute: string; search: string
}) {
  const groups = groupTests(tests, summaries, search)
  if (!groups.some(group => group.tests.length)) return <p>{SURFACE_COPY.noMatches}</p>
  return <>{groups.map((group, index) => {
    if (!group.tests.length) return null
    const cards = <div className="xp-tests-cards">{group.tests.map(test => {
      const card = homeCard(test, summaries[test.id], adminRoute)
      return <article className="xp-tests-card" key={test.id}>
        <div className="xp-tests-card-heading"><h3>{test.name}</h3><span>{card.kind}</span>
          <span title={card.pill.tooltip}><Pill>{card.pill.label}</Pill></span>
          {test.status === 'running' && card.health ? <span role="img" aria-label={SURFACE_COPY.health[card.health]}
            className={`xp-tests-health xp-tests-health--${card.health}`} /> : null}
        </div>
        <p>{card.line}</p>{card.headline ? <p>{card.headline}</p> : null}
        <Link href={card.href}>{card.action}</Link>
      </article>
    })}</div>
    return index === 5 ? <details className="xp-tests-group" key={group.label}><summary>{group.label}</summary>{cards}</details>
      : <section className="xp-tests-group" key={group.label} aria-label={group.label}><h2>{group.label}</h2>{cards}</section>
  })}</>
}

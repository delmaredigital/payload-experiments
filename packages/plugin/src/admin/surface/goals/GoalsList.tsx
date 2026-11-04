'use client'
import { useEffect, useState } from 'react'
import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import { Banner, EmptyState } from '../../../ui/Feedback.js'
import { Button } from '../../../ui/Button.js'
import { SearchInput } from '../../../ui/Inputs.js'
import type { SurfaceProps } from '../contracts.js'
import { SurfaceShell } from '../SurfaceShell.js'
import { SURFACE_COPY } from '../../copy/surface.js'
import { GOALS_COPY as C, goalsNoMatches, goalUsedBy } from '../../copy/goals.js'
import { METRIC_KIND_LABELS } from '../../copy/metrics.js'
import { goalUsage } from './goals.model.js'
import type { Goal, GoalUsageTest } from './goals.model.js'
import { goalPages } from './data.js'
import './goals.css'

export function GoalsList({ surface, returnToTest }: { surface: SurfaceProps; returnToTest?: string }) {
  const [data, setData] = useState<{ goals: Goal[]; tests: GoalUsageTest[] }>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')
  const returnQuery = returnToTest ? `?${new URLSearchParams({ return: returnToTest })}` : ''
  const url = (path: string) => formatAdminURL({ adminRoute: surface.adminRoute, path })
  useEffect(() => {
    const controller = new AbortController()
    setData(undefined); setError('')
    const base = surface.apiRoute.replace(/\/$/, '')
    void Promise.all([goalPages<Goal>(base, 'xp-metrics', controller.signal), goalPages<GoalUsageTest>(base, 'xp-experiments', controller.signal)])
      .then(([goals, tests]) => { if (!controller.signal.aborted) setData({ goals, tests }) })
      .catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : C.loadError) })
    return () => controller.abort()
  }, [surface.apiRoute, attempt])
  const usage = goalUsage(data?.tests ?? [])
  const showSearch = (data?.goals.length ?? 0) > 8
  const goals = data?.goals.filter(goal => !showSearch || goal.name.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) ?? []
  const newGoal = surface.canManage ? <Button variant="primary" href={url(`/experiments/goals/new${returnQuery}`)}>{C.newGoal}</Button> : null
  return <SurfaceShell adminRoute={surface.adminRoute} title={C.title}
    crumbs={[{ label: SURFACE_COPY.title, href: url('/experiments') }, { label: C.title }]}
    actions={<>{returnToTest ? <Button variant="quiet" href={url(`/experiments/${encodeURIComponent(returnToTest)}`)}>{C.backToTest}</Button> : null}{newGoal}</>}>
    <div className="xp-goals">
      {showSearch ? <SearchInput id="xp-goals-search" label={C.search} placeholder={C.search} value={search} onChange={event => setSearch(event.target.value)} /> : null}
      {error ? <Banner tone="error" action={<Button size="sm" onClick={() => setAttempt(n => n + 1)}>{C.retry}</Button>}>{error}</Banner>
        : !data ? <p role="status">{C.loading}</p> : !data.goals.length ? <EmptyState action={newGoal}>{C.empty}</EmptyState>
          : !goals.length ? <EmptyState action={<Button variant="quiet" onClick={() => setSearch('')}>{C.clearSearch}</Button>}>{goalsNoMatches(search)}</EmptyState>
            : <div className="xp-tests-list">{goals.map(goal => {
              const count = usage.get(goal.id) ?? 0
              const kind = surface.metricSources.find(source => source.id === goal.source)?.kind
              const label = kind && Object.hasOwn(METRIC_KIND_LABELS, kind) ? METRIC_KIND_LABELS[kind] : undefined
              const href = url(`/experiments/goals/${encodeURIComponent(String(goal.id))}${returnQuery}`)
              return <article className="xp-tests-row" key={`${typeof goal.id}:${goal.id}`}>
                <div className="xp-tests-row-main">
                  <div className="xp-tests-row-name"><Link href={href}>{goal.name}</Link>{label ? <span className="xp-tests-kind">{label[0]!.toUpperCase() + label.slice(1)}</span> : null}</div>
                  <div className="xp-tests-row-line"><span>{goal.direction === 'decrease' ? C.decrease : C.increase}</span><span aria-hidden="true">·</span><span>{count ? goalUsedBy(count) : C.unused}</span></div>
                </div>
                <Button className="xp-tests-row-action" variant={returnToTest ? 'primary' : 'secondary'} size="sm" href={href}>{returnToTest ? C.useGoal : C.open}</Button>
              </article>
            })}</div>}
    </div>
  </SurfaceShell>
}

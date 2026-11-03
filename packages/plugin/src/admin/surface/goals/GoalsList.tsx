'use client'
import { useEffect, useState } from 'react'
import { Link, Pill } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type { SurfaceProps } from '../contracts.js'
import { GOALS_COPY as C } from '../../copy/goals.js'
import { goalUsage } from './goals.model.js'
import type { Goal, GoalUsageTest } from './goals.model.js'
import { goalPages } from './data.js'
import { GoalsBreadcrumb } from './GoalsBreadcrumb.js'
import './goals.css'

export function GoalsList({ surface, returnToTest }: { surface: SurfaceProps; returnToTest?: string }) {
  const [data, setData] = useState<{ goals: Goal[]; tests: GoalUsageTest[] }>()
  const [error, setError] = useState('')
  const [attempt, setAttempt] = useState(0)
  const returnQuery = returnToTest ? `?${new URLSearchParams({ return: returnToTest })}` : ''
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
  const newGoal = <Link className="xp-tests-primary" href={formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/goals/new${returnQuery}` })}>{C.newGoal}</Link>
  return <div className="xp-goals">
    <GoalsBreadcrumb adminRoute={surface.adminRoute} />
    <div className="xp-tests-toolbar"><h1>{C.title}</h1>{newGoal}</div>
    {error ? <p role="alert">{error}{' '}<button type="button" onClick={() => setAttempt(n => n + 1)}>{C.retry}</button></p>
      : !data ? <p role="status">{C.loading}</p> : !data.goals.length ? <p>{C.empty}</p>
        : <div className="xp-goals-table"><table><thead><tr>{[C.name, C.source, C.directionColumn, C.usedBy, C.status].map(label => <th scope="col" key={label}>{label}</th>)}</tr></thead>
          <tbody>{data.goals.map(goal => {
            const count = usage.get(goal.id) ?? 0
            return <tr key={`${typeof goal.id}:${goal.id}`}>
              <th scope="row"><Link href={formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/goals/${encodeURIComponent(String(goal.id))}${returnQuery}` })}>{goal.name}</Link></th>
              <td>{surface.metricSources.find(source => source.id === goal.source)?.label ?? goal.source}</td>
              <td>{goal.direction === 'decrease' ? C.decrease : C.increase}</td><td>{count}</td><td><Pill>{count ? C.inUse : C.unused}</Pill></td>
            </tr>
          })}</tbody></table></div>}
  </div>
}

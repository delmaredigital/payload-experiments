'use client'
import { useEffect, useState } from 'react'
import type { SectionProps } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { metricSourceOptions } from '../../metricSource.model.js'
import { reviewView } from '../../review/review.model.js'
import { FieldErrors, reasonFor, save, SelectEdit, TextEdit } from './fields.js'
import { Section } from './Section.js'

type Metric = { id: string | number; name: string; source: string }
export function GoalSection({ test, surface }: SectionProps) {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [query, setQuery] = useState('')
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        const all: Metric[] = []
        let page = 1
        for (;;) {
          const response = await fetch(`${surface.apiRoute.replace(/\/$/, '')}/xp-metrics?depth=0&limit=100&page=${page}`, { credentials: 'include', signal: controller.signal })
          if (!response.ok) throw new Error()
          const body = await response.json() as { docs: Metric[]; hasNextPage?: boolean }
          if (!Array.isArray(body.docs)) throw new Error()
          all.push(...body.docs)
          if (!body.hasNextPage) break
          page++
        }
        if (!controller.signal.aborted) { setMetrics(all); setFailed(false) }
      } catch { if (!controller.signal.aborted) setFailed(true) }
    })()
    return () => controller.abort()
  }, [surface.apiRoute, attempt])
  const doc = test.doc!
  const reason = reasonFor(test, 'metrics')
  const sources = metricSourceOptions(surface.metricSources)
  const options = metrics.map(metric => ({ value: String(metric.id), label: `${metric.name} · ${sources.find(source => source.value === metric.source)?.badge ?? metric.source}` }))
  const chosen = [doc.metrics?.primary, ...(doc.metrics?.guardrails ?? []), ...(doc.metrics?.secondary ?? [])].filter(id => id != null).map(String)
  const visible = options.filter(option => chosen.includes(option.value) || option.label.toLowerCase().includes(query.toLowerCase()))
  for (const id of chosen) if (!visible.some(option => option.value === id)) visible.push({ value: id, label: id })
  const roleOptions = (role: 'primary' | 'guardrails' | 'secondary') => {
    const blocked = new Set([...(role !== 'primary' && doc.metrics?.primary != null ? [doc.metrics.primary] : []),
      ...(role !== 'guardrails' ? doc.metrics?.guardrails ?? [] : []), ...(role !== 'secondary' ? doc.metrics?.secondary ?? [] : [])].map(String))
    return visible.filter(option => !blocked.has(option.value))
  }
  const change = (role: 'primary' | 'guardrails' | 'secondary', value: string | string[]) => save(test, 'metrics', () => ({
    metrics: { ...test.doc!.metrics, [role]: role === 'primary' ? value || null : value },
  }))
  const primary = metrics.find(metric => String(metric.id) === String(doc.metrics?.primary))
  const kind = surface.metricSources.find(source => source.id === primary?.source)?.kind
  const baseline = test.preflight?.baseline && String(test.preflight.baseline.metricId) === String(doc.metrics?.primary)
    ? reviewView(test.preflight, { status: doc.status, primaryMetricKind: kind }).baseline : null
  return <Section test={test} sectionId="win">
    {!reason ? <TextEdit label={C.searchGoals} value={query} onDraft={setQuery} onCommit={setQuery} /> : null}
    {failed ? <p role="alert">{C.goalsError} <button type="button" onClick={() => setAttempt(n => n + 1)}>{C.retry}</button></p> : null}
    <SelectEdit label={C.goal} value={String(doc.metrics?.primary ?? '')} options={[{ value: '', label: C.chooseGoal }, ...roleOptions('primary')]} reason={reason} onCommit={value => change('primary', value)} />
    <p>{C.goalHelp}</p><a href={`${surface.adminRoute}/collections/xp-metrics`}>{C.manageGoals}</a>
    <FieldErrors test={test} path="metrics.primary" />
    <SelectEdit label={C.guardrails} value={(doc.metrics?.guardrails ?? []).map(String)} options={roleOptions('guardrails')} multiple reason={reason} onCommit={value => change('guardrails', value)} />
    <p>{C.guardrailHelp}</p><FieldErrors test={test} path="metrics.guardrails" />
    <SelectEdit label={C.secondary} value={(doc.metrics?.secondary ?? []).map(String)} options={roleOptions('secondary')} multiple reason={reason} onCommit={value => change('secondary', value)} />
    <FieldErrors test={test} path="metrics.secondary" />
    {baseline ? <p>{primary?.name ? `${primary.name}: ` : ''}{baseline}</p> : null}
    {test.errors.metrics ? <p role="alert">{test.errors.metrics}</p> : null}
  </Section>
}

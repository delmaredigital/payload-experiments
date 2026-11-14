'use client'
import { fetchAllDocs } from '../../../lib/fetchAllDocs.js'
import { Button } from '../../../ui/Button.js'
import { useEffect, useMemo, useState } from 'react'
import { surfaceUrls } from '../../surfaceUrls.js'
import type { SectionProps } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { METRIC_KIND_LABELS } from '../../copy/metrics.js'
import { isClickSource } from '../../../goals/key.js'
import type { ClickKeysResult } from '../../../types/endpoints.js'
import { createApi } from '../../api.js'
import { sourceFor } from '../../metricSource.model.js'
import { reviewView } from '../../review/review.model.js'
import { CheckboxList, FieldErrors, reasonFor, save, SelectEdit } from './fields.js'
import { Section } from './Section.js'

type Metric = { id: string | number; name: string; source: string }
export function GoalSection({ test, surface, embedded = false }: SectionProps & { embedded?: boolean }) {
  const api = useMemo(() => createApi(surface.apiRoute), [surface.apiRoute])
  const [clickKeys, setClickKeys] = useState<ClickKeysResult['keys']>([])
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    void (async () => {
      try {
        await Promise.resolve()
        if (controller.signal.aborted) return
        const response = await fetchAllDocs<Metric>(`${surface.apiRoute.replace(/\/$/, '')}/xp-metrics?depth=0`, {
          credentials: 'include', signal: controller.signal,
        })
        if (!response.ok) throw new Error()
        if (!controller.signal.aborted) { setMetrics(response.docs); setFailed(false); setLoaded(true) }
      } catch { if (!controller.signal.aborted) setFailed(true) }
    })()
    return () => controller.abort()
  }, [surface.apiRoute, attempt])
  const doc = test.doc!
  useEffect(() => {
    if (!surface.canManage) { setClickKeys([]); return }
    let active = true
    let lastReturn = -Infinity
    let sequence = 0
    async function loadKeys() {
      const request = ++sequence
      const result = await api.clickKeys(doc.id)
      if (active && request === sequence) setClickKeys(result.ok && Array.isArray(result.data?.keys) ? result.data.keys : [])
    }
    const focus = () => {
      if (document.visibilityState !== 'visible' || Date.now() - lastReturn < 100) return
      lastReturn = Date.now()
      void loadKeys()
    }
    const visible = () => { if (document.visibilityState === 'visible') focus() }
    void loadKeys()
    window.addEventListener('focus', focus); document.addEventListener('visibilitychange', visible)
    return () => { active = false; window.removeEventListener('focus', focus); document.removeEventListener('visibilitychange', visible) }
  }, [api, doc.id, surface.canManage])
  const reason = reasonFor(test, 'metrics')
  useEffect(() => {
    if (embedded || !loaded) return
    const url = new URL(window.location.href)
    const goalId = url.searchParams.get('goal')
    if (goalId == null) return
    url.searchParams.delete('goal')
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
    const goal = metrics.find(metric => String(metric.id) === goalId)
    if (!reason && goal) {
      save(test, 'metrics', () => ({ metrics: { ...doc.metrics, primary: goal.id,
        guardrails: doc.metrics?.guardrails?.filter(id => String(id) !== goalId), secondary: doc.metrics?.secondary?.filter(id => String(id) !== goalId) } }))
    }
  }, [embedded, loaded, metrics, reason, doc.metrics, test])
  const unknownGoal = loaded ? C.missingGoal : C.goalUnavailable
  const options = metrics.map(metric => {
    const kind = sourceFor(metric.source, surface.metricSources)?.kind
    return { value: String(metric.id), label: `${metric.name} · ${kind ? METRIC_KIND_LABELS[kind] : metric.source}` }
  })
  const onPage = new Map(metrics.flatMap(metric => {
    const found = isClickSource(metric.source) ? clickKeys.find(row => row.key === metric.source.slice(6)) : undefined
    return found ? [[String(metric.id), `${metric.name} · ${found.label}`] as const] : []
  }))
  const chosen = [doc.metrics?.primary, ...(doc.metrics?.guardrails ?? []), ...(doc.metrics?.secondary ?? [])].filter(id => id != null).map(String)
  const visible = [...options]
  for (const id of chosen) if (!visible.some(option => option.value === id)) visible.push({ value: id, label: unknownGoal })
  const roleOptions = (role: 'primary' | 'guardrails' | 'secondary') => {
    const blocked = new Set([...(role !== 'primary' && doc.metrics?.primary != null ? [doc.metrics.primary] : []),
      ...(role !== 'guardrails' ? doc.metrics?.guardrails ?? [] : []), ...(role !== 'secondary' ? doc.metrics?.secondary ?? [] : [])].map(String))
    return visible.filter(option => !blocked.has(option.value))
  }
  const roleGroups = (role: 'primary' | 'guardrails' | 'secondary') => onPage.size ? [
    { label: C.clickPageGroup, options: roleOptions(role).filter(option => onPage.has(option.value)).map(option => ({ ...option, label: onPage.get(option.value)! })) },
    { options: roleOptions(role).filter(option => !onPage.has(option.value)) },
  ] : undefined
  const originalId = (value: string) => metrics.find(metric => String(metric.id) === value)?.id
    ?? [test.doc!.metrics?.primary, ...(test.doc!.metrics?.guardrails ?? []), ...(test.doc!.metrics?.secondary ?? [])].find(id => id != null && String(id) === value)
  const changePrimary = (value: string) => {
    const id = value ? originalId(value) : null
    if (id === undefined || id === (test.doc!.metrics?.primary ?? null)) return
    save(test, 'metrics', () => ({ metrics: { ...test.doc!.metrics, primary: id } }))
  }
  const toggle = (role: 'guardrails' | 'secondary', value: string, checked: boolean) => save(test, 'metrics', () => {
    const current = test.doc!.metrics
    const ids = current?.[role] ?? []
    const id = originalId(value)
    return { metrics: { ...current, [role]: checked && id != null
      ? ids.some(saved => String(saved) === value) ? ids : [...ids, id]
      : ids.filter(saved => String(saved) !== value) } }
  })
  const display = (ids: Array<string | number>) => ids.length ? ids.map(id => options.find(option => option.value === String(id))?.label ?? unknownGoal).join(', ') : C.noGoal
  const primary = metrics.find(metric => String(metric.id) === String(doc.metrics?.primary))
  const kind = sourceFor(primary?.source, surface.metricSources)?.kind
  const baseline = test.preflight?.baseline && String(test.preflight.baseline.metricId) === String(doc.metrics?.primary)
    ? reviewView(test.preflight, { primaryMetricKind: kind }).baseline : null
  return <Section surface={surface} test={test} sectionId="win">
    {failed ? <p role="alert">{C.goalsError} <span className="xp-ui-button-group"><Button onClick={() => setAttempt(n => n + 1)}>{C.retry}</Button></span></p> : null}
    <SelectEdit labelAction={<span className="xp-ui-button-group"><Button variant="link" size="sm" href={surfaceUrls.goals(surface.adminRoute, !reason ? { return: String(doc.id) } : undefined)}>{C.manageGoals}</Button></span>} label={C.goal} value={loaded && !primary ? '' : String(doc.metrics?.primary ?? '')} options={[{ value: '', label: C.chooseGoal }, ...roleOptions('primary')]} groups={onPage.size ? [{ options: [{ value: '', label: C.chooseGoal }] }, ...roleGroups('primary')!] : undefined} reason={reason} readOnlyValue={display(doc.metrics?.primary == null ? [] : [doc.metrics.primary])} onCommit={changePrimary} />
    <p>{C.goalHelp}</p>
    {primary && isClickSource(primary.source) ? <p>{C.clickGoalHelp}</p> : null}
    {baseline ? <p>{primary?.name ? `${primary.name}: ` : ''}{baseline}</p> : null}
    <FieldErrors test={test} path="metrics.primary" />
    <CheckboxList searchable={metrics.length > 8} label={C.guardrails} value={(doc.metrics?.guardrails ?? []).map(String)} options={roleOptions('guardrails')} groups={roleGroups('guardrails')} reason={reason} readOnlyValue={display(doc.metrics?.guardrails ?? [])} onToggle={(value, checked) => toggle('guardrails', value, checked)} />
    <p>{C.guardrailHelp}</p><FieldErrors test={test} path="metrics.guardrails" />
    <CheckboxList searchable={metrics.length > 8} label={C.secondary} value={(doc.metrics?.secondary ?? []).map(String)} options={roleOptions('secondary')} groups={roleGroups('secondary')} reason={reason} readOnlyValue={display(doc.metrics?.secondary ?? [])} onToggle={(value, checked) => toggle('secondary', value, checked)} />
    <FieldErrors test={test} path="metrics.secondary" />
    {metrics.some(metric => isClickSource(metric.source)) ? <p>{C.clickGoalsNote}</p> : null}
    {test.errors.metrics ? <p role="alert">{test.errors.metrics}</p> : null}
  </Section>
}

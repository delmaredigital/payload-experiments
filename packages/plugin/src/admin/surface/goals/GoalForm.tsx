'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { Link } from '@payloadcms/ui'
import { formatAdminURL } from 'payload/shared'
import type { SurfaceProps } from '../contracts.js'
import { GOALS_COPY as C, goalUsedBy } from '../../copy/goals.js'
import { metricSourceHint, metricSourceOptions } from '../../metricSource.model.js'
import { validateCappingType, validateCappingValue } from '../../../collections/metricValidation.js'
import { goalSlug, goalUsage } from './goals.model.js'
import type { Goal, GoalUsageTest } from './goals.model.js'
import { goalPages, goalResponse } from './data.js'
import { GoalsBreadcrumb } from './GoalsBreadcrumb.js'
import './goals.css'

type Draft = Omit<Goal, 'id' | 'capping' | 'guardrailThreshold'> & {
  capType: '' | 'percentile' | 'absolute'; capValue: string; warningPercent: string
}
const empty = (): Draft => ({ name: '', slug: '', source: '', direction: 'increase', attributionWindowHours: 168,
  minSampleSize: 150, capType: '', capValue: '', warningPercent: '5' })

export function GoalForm({ surface, id, returnToTest }: { surface: SurfaceProps; id?: string; returnToTest?: string }) {
  const router = useRouter()
  const base = surface.apiRoute.replace(/\/$/, '')
  const [draft, setDraft] = useState<Draft>(empty)
  const [goal, setGoal] = useState<Goal>()
  const [usedBy, setUsedBy] = useState(0)
  const [ready, setReady] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<'capType' | 'capValue' | 'warningPercent', string>>>({})
  const [pending, setPending] = useState<'save' | 'delete' | null>(null)
  const [slugEdited, setSlugEdited] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(false)
  const returnQuery = returnToTest ? `?${new URLSearchParams({ return: returnToTest })}` : ''
  const listUrl = formatAdminURL({ adminRoute: surface.adminRoute, path: `/experiments/goals${returnQuery}` })
  useEffect(() => {
    const controller = new AbortController()
    setReady(false); setLoadError('')
    void (async () => {
      try {
        if (id !== undefined) {
          const [loaded, tests] = await Promise.all([
            fetch(`${base}/xp-metrics/${encodeURIComponent(id)}?depth=0`, { credentials: 'include', signal: controller.signal })
              .then(response => goalResponse(response, C.loadError)) as Promise<Goal>,
            goalPages<GoalUsageTest>(base, 'xp-experiments', controller.signal),
          ])
          if (loaded.id == null) throw new Error(C.missing)
          if (controller.signal.aborted) return
          const defaultCap = surface.metricSources.some(source => source.id === loaded.source && source.kind === 'revenue')
            && loaded.capping?.type == null && loaded.capping?.value == null
          setGoal(loaded); setUsedBy(goalUsage(tests).get(loaded.id) ?? 0)
          setDraft({ ...empty(), ...loaded, capType: loaded.capping?.type ?? (defaultCap ? 'percentile' : ''), capValue: loaded.capping?.value == null ? defaultCap ? '0.99' : '' : String(loaded.capping.value),
            warningPercent: String(Number(((loaded.guardrailThreshold ?? 0.05) * 100).toPrecision(12))) })
          setSlugEdited(true)
        }
        if (!controller.signal.aborted) setReady(true)
      } catch (cause) { if (!controller.signal.aborted) setLoadError(cause instanceof Error ? cause.message : C.loadError) }
    })()
    return () => controller.abort()
  }, [base, id, attempt])
  const source = surface.metricSources.find(source => source.id === draft.source)
  const hint = metricSourceHint(source)
  const options = metricSourceOptions(surface.metricSources)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  async function submit() {
    if (inFlight.current || !ready) return
    const capValue = draft.capValue.trim() === '' ? null : Number(draft.capValue)
    const typeError = validateCappingType(draft.capType || null, capValue, source?.kind)
    const valueError = validateCappingValue(capValue, draft.capType || null)
    const warningPercent = draft.warningPercent.trim() === '' ? 5 : Number(draft.warningPercent)
    const errors = { ...(typeError !== true ? { capType: typeError } : {}), ...(valueError !== true ? { capValue: valueError } : {}),
      ...(!Number.isFinite(warningPercent) || warningPercent < 0 ? { warningPercent: C.thresholdError } : {}) }
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    inFlight.current = true; setPending('save'); setError('')
    try {
      // Use an explicit body: loaded metadata and presentation fields never go back to Payload.
      const body = { name: draft.name, slug: usedBy && goal ? goal.slug : draft.slug, source: draft.source, direction: draft.direction,
        attributionWindowHours: draft.attributionWindowHours, minSampleSize: draft.minSampleSize,
        capping: { type: draft.capType || null, value: capValue }, guardrailThreshold: warningPercent / 100 }
      const response = await fetch(`${base}/xp-metrics${id === undefined ? '' : `/${encodeURIComponent(id)}`}`, {
        method: id === undefined ? 'POST' : 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const saved = await goalResponse(response, C.saveError) as { doc?: Goal }
      if (saved.doc?.id == null) throw new Error(C.saveError)
      router.push(id === undefined && returnToTest ? formatAdminURL({ adminRoute: surface.adminRoute,
        path: `/experiments/${encodeURIComponent(returnToTest)}?${new URLSearchParams({ goal: String(saved.doc.id) })}` }) : listUrl)
    } catch (cause) { setError(cause instanceof Error ? cause.message : C.saveError); inFlight.current = false; setPending(null) }
  }
  async function remove() {
    if (inFlight.current || !ready || usedBy || id === undefined) return
    inFlight.current = true; setPending('delete'); setError('')
    try {
      const response = await fetch(`${base}/xp-metrics/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
      await goalResponse(response, C.deleteError)
      router.push(listUrl)
    } catch (cause) { setError(cause instanceof Error ? cause.message : C.deleteError); inFlight.current = false; setPending(null) }
  }
  return <div className="xp-goals">
    <GoalsBreadcrumb adminRoute={surface.adminRoute} name={goal?.name ?? (id === undefined ? C.newGoal : undefined)} returnQuery={returnQuery} />
    <h1>{goal?.name ?? (id === undefined ? C.newGoal : C.title)}</h1>
    {loadError ? <p role="alert">{loadError}{' '}<button type="button" onClick={() => setAttempt(n => n + 1)}>{C.retry}</button></p>
      : !ready ? <p role="status">{C.loading}</p> : <form className="xp-goal-form" onSubmit={event => { event.preventDefault(); void submit() }}>
        <fieldset disabled={pending !== null}>
          <label className="xp-field">{C.name}<input required value={draft.name} onChange={event => {
            const name = event.currentTarget.value
            setDraft(current => ({ ...current, name, ...(!slugEdited && !usedBy ? { slug: goalSlug(name) } : {}) }))
          }} /></label>
          <label className="xp-field">{C.slug}<input required value={draft.slug} readOnly={usedBy > 0} aria-describedby="xp-goal-slug-help"
            onChange={event => { setSlugEdited(true); set('slug', event.currentTarget.value) }} /></label>
          <p id="xp-goal-slug-help">{usedBy ? C.slugLocked : C.slugHelp}</p>
          <label className="xp-field">{C.source}<select required value={draft.source} onChange={event => {
            const sourceId = event.currentTarget.value
            const revenue = surface.metricSources.find(source => source.id === sourceId)?.kind === 'revenue'
            setDraft(current => ({ ...current, source: sourceId, capType: revenue ? 'percentile' : '', capValue: revenue ? '0.99' : '' }))
          }}><option value="">{C.chooseSource}</option>{options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
            {draft.source && !options.some(option => option.value === draft.source) ? <option value={draft.source}>{draft.source}</option> : null}
          </select></label>{hint ? <p>{hint}</p> : null}
          <label className="xp-field">{C.direction}<select value={draft.direction} onChange={event => set('direction', event.currentTarget.value as Draft['direction'])}>
            <option value="increase">{C.increase}</option><option value="decrease">{C.decrease}</option>
          </select></label>
          <label className="xp-field">{C.window}<input required type="number" min="1" step="any" value={draft.attributionWindowHours ?? ''} onChange={event => set('attributionWindowHours', event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} /></label>
          <label className="xp-field">{C.minimum}<input required type="number" min="1" step="any" value={draft.minSampleSize ?? ''} onChange={event => set('minSampleSize', event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} /></label>
          <details><summary>{C.advanced}</summary>
            <fieldset><legend>{C.capping}</legend>
              <label className="xp-field">{C.capType}<select required={source?.kind === 'revenue'} value={draft.capType} aria-invalid={fieldErrors.capType ? true : undefined} aria-describedby={fieldErrors.capType ? 'xp-goal-cap-type-error' : undefined} onChange={event => {
                const capType = event.currentTarget.value as Draft['capType']
                setDraft(current => ({ ...current, capType, capValue: capType ? current.capValue : '' }))
              }}>{source?.kind !== 'revenue' ? <option value="">{C.noCap}</option> : null}<option value="percentile">{C.percentile}</option><option value="absolute">{C.absolute}</option></select></label>
              {fieldErrors.capType ? <p id="xp-goal-cap-type-error" role="alert">{fieldErrors.capType}</p> : null}
              <label className="xp-field">{C.capValue}<input type="number" step="any" min="0" disabled={!draft.capType} value={draft.capValue} aria-invalid={fieldErrors.capValue ? true : undefined} aria-describedby={fieldErrors.capValue ? 'xp-goal-cap-value-error' : undefined} onChange={event => set('capValue', event.currentTarget.value)} /></label><p>{C.capHelp}</p>
              {fieldErrors.capValue ? <p id="xp-goal-cap-value-error" role="alert">{fieldErrors.capValue}</p> : null}
            </fieldset>
            <label className="xp-field">{C.threshold}<input type="number" min="0" step="any" value={draft.warningPercent} aria-invalid={fieldErrors.warningPercent ? true : undefined} aria-describedby={fieldErrors.warningPercent ? 'xp-goal-threshold-error' : undefined}
              onInvalid={() => setFieldErrors(current => ({ ...current, warningPercent: C.thresholdError }))} onChange={event => set('warningPercent', event.currentTarget.value)} /></label>
            {fieldErrors.warningPercent ? <p id="xp-goal-threshold-error" role="alert">{fieldErrors.warningPercent}</p> : null}
          </details>
        </fieldset>
        {error ? <p role="alert">{error}</p> : null}
        <div className="xp-tests-toolbar"><button type="submit" disabled={pending !== null}>{pending === 'save' ? C.saving : C.save}</button>
          <Link className="xp-goal-cancel" href={listUrl}>{C.cancel}</Link>
          {id === undefined ? null : <><button type="button" disabled={pending !== null || usedBy > 0} aria-describedby={usedBy ? 'xp-goal-used' : undefined} onClick={() => void remove()}>{pending === 'delete' ? C.deleting : C.remove}</button>
            {usedBy ? <span id="xp-goal-used">{goalUsedBy(usedBy)}</span> : null}</>}
        </div>
      </form>}
  </div>
}

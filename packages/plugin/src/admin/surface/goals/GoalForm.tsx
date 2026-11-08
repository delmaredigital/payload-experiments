'use client'
import { surfaceUrls } from '../../surfaceUrls.js'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation.js'
import { formatAdminURL } from 'payload/shared'
import type { SurfaceProps } from '../contracts.js'
import { GOALS_COPY as C, goalDeleteLocked, goalInUse } from '../../copy/goals.js'
import { metricSourceHint, metricSourceOptions, sourceFor } from '../../metricSource.model.js'
import { validateCappingType, validateCappingValue } from '../../../collections/metricValidation.js'
import { CLICK_KEY } from '../../../goals/key.js'
import { clickGoalSlug } from '../../../goals/picker/clickGoalPicker.model.js'
import { goalSlug, goalUsage } from './goals.model.js'
import type { Goal, GoalUsageTest } from './goals.model.js'
import { GoalResponseError, goalPages, goalResponse } from './data.js'
import { SURFACE_COPY } from '../../copy/surface.js'
import { SurfaceShell } from '../SurfaceShell.js'
import { Button } from '../../../ui/Button.js'
import { TextInput, NumberInput, Select } from '../../../ui/Inputs.js'
import { Card } from '../../../ui/Card.js'
import { Banner } from '../../../ui/Feedback.js'
import { Dialog } from '../../../ui/Dialog.js'
import './goals.css'

type Draft = Omit<Goal, 'id' | 'capping' | 'guardrailThreshold'> & {
  capType: '' | 'percentile' | 'absolute'; capValue: string; warningPercent: string
}
type FieldErrors = Partial<Record<keyof Draft, string>>
const fieldNames: Record<string, keyof Draft> = { name: 'name', slug: 'slug', source: 'source', direction: 'direction',
  attributionWindowHours: 'attributionWindowHours', minSampleSize: 'minSampleSize',
  'capping.type': 'capType', 'capping.value': 'capValue', guardrailThreshold: 'warningPercent' }
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
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [seenFieldErrors, setSeenFieldErrors] = useState(fieldErrors)
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [pending, setPending] = useState<'save' | 'delete' | null>(null)
  const [slugEdited, setSlugEdited] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const inFlight = useRef(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const listUrl = surfaceUrls.goals(surface.adminRoute, returnToTest ? { return: returnToTest } : undefined)
  useEffect(() => {
    const controller = new AbortController()
    setReady(false); setLoadError('')
    void (async () => {
      try {
        if (id !== undefined) {
          const [loaded, tests] = await Promise.all([
            fetch(`${base}/xp-metrics/${encodeURIComponent(id)}?depth=0`, { credentials: 'include', signal: controller.signal })
              .then(response => goalResponse(response, C.loadError, { notFound: C.notFound })) as Promise<Goal>,
            goalPages<GoalUsageTest>(base, 'xp-experiments', controller.signal),
          ])
          if (loaded.id == null) throw new Error(C.missing)
          if (controller.signal.aborted) return
          const defaultCap = sourceFor(loaded.source, surface.metricSources)?.kind === 'revenue'
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
  const source = sourceFor(draft.source, surface.metricSources)
  const click = draft.source.startsWith('click:')
  // Keep the disclosure and its new field errors in the same commit.
  if (fieldErrors !== seenFieldErrors) {
    setSeenFieldErrors(fieldErrors)
    if ((click && fieldErrors.slug) || fieldErrors.capType || fieldErrors.capValue || fieldErrors.warningPercent) setAdvancedOpen(true)
  }
  const hint = metricSourceHint(source)
  const options = metricSourceOptions(surface.metricSources)
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft(current => ({ ...current, [key]: value }))
  async function submit() {
    if (inFlight.current || !ready || !surface.canManage) return
    const capValue = click || draft.capValue.trim() === '' ? null : Number(draft.capValue)
    const typeError = validateCappingType(click ? null : draft.capType || null, capValue, source?.kind)
    const valueError = validateCappingValue(capValue, click ? null : draft.capType || null)
    const warningPercent = draft.warningPercent.trim() === '' ? 5 : Number(draft.warningPercent)
    const errors = { ...(click && !CLICK_KEY.test(draft.slug) ? { slug: C.slugRule } : {}), ...(typeError !== true ? { capType: typeError } : {}), ...(valueError !== true ? { capValue: valueError } : {}),
      ...(!Number.isFinite(warningPercent) || warningPercent < 0 ? { warningPercent: C.thresholdError } : {}) }
    setFieldErrors(errors)
    if (Object.keys(errors).length) return
    inFlight.current = true; setPending('save'); setError('')
    try {
      // Use an explicit body: loaded metadata and presentation fields never go back to Payload.
      const body = { name: draft.name, slug: usedBy && goal ? goal.slug : draft.slug, source: usedBy && goal ? goal.source : click ? `click:${draft.slug}` : draft.source, direction: click ? 'increase' : draft.direction,
        attributionWindowHours: draft.attributionWindowHours, minSampleSize: draft.minSampleSize,
        capping: { type: click ? null : draft.capType || null, value: capValue }, guardrailThreshold: warningPercent / 100 }
      const response = await fetch(`${base}/xp-metrics${id === undefined ? '' : `/${encodeURIComponent(id)}`}`, {
        method: id === undefined ? 'POST' : 'PATCH', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const saved = await goalResponse(response, C.saveError, { notFound: C.notFound }) as { doc?: Goal }
      if (saved.doc?.id == null) throw new Error(C.saveError)
      router.push(id === undefined && returnToTest ? formatAdminURL({ adminRoute: surface.adminRoute,
        path: `/experiments/${encodeURIComponent(returnToTest)}?${new URLSearchParams({ goal: String(saved.doc.id) })}` }) : listUrl)
    } catch (cause) {
      setError(cause instanceof GoalResponseError ? cause.message : C.saveError)
      if (cause instanceof GoalResponseError) setFieldErrors(Object.fromEntries(Object.entries(cause.fields).flatMap(([path, message]) => fieldNames[path] ? [[fieldNames[path], path === 'slug' ? click ? C.duplicateSlug : C.duplicateSlugMain : message]] : [])))
      inFlight.current = false; setPending(null)
    }
  }
  async function remove() {
    if (inFlight.current || !confirmDelete || !ready || !surface.canManage || usedBy || id === undefined) return
    inFlight.current = true; setPending('delete'); setError(''); setConfirmDelete(false)
    try {
      const response = await fetch(`${base}/xp-metrics/${encodeURIComponent(id)}`, { method: 'DELETE', credentials: 'include' })
      await goalResponse(response, C.deleteError, { notFound: C.notFound })
      router.push(listUrl)
    } catch (cause) { setError(cause instanceof Error ? cause.message : C.deleteError); inFlight.current = false; setPending(null) }
  }
  const title = goal?.name ?? (id === undefined ? C.newGoal : C.goal)
  return <SurfaceShell adminRoute={surface.adminRoute} title={title}
    crumbs={[{ label: SURFACE_COPY.title, href: surfaceUrls.home(surface.adminRoute) },
      { label: C.title, href: listUrl }, { label: title }]}
    status={usedBy ? <span className="xp-tests-kind">{goalInUse(usedBy)}</span> : undefined}>
    <div className="xp-goals">
      {loadError ? <Banner tone="error" action={<Button size="sm" onClick={() => setAttempt(n => n + 1)}>{C.retry}</Button>}>{loadError}</Banner>
        : !ready ? <p role="status">{C.loading}</p> : <form className="xp-goal-form" onSubmit={event => { event.preventDefault(); void submit() }}>
          {error ? <Banner tone="error">{error}</Banner> : null}
          <Card className="xp-goal-card">
            <h2>{C.fields}</h2>
            <fieldset disabled={pending !== null || !surface.canManage}>
              <TextInput id="xp-goal-name" label={C.name} required value={draft.name} error={fieldErrors.name} onChange={event => {
                const name = event.currentTarget.value
                setDraft(current => ({ ...current, name, ...(!slugEdited && !usedBy ? { slug: click ? clickGoalSlug(name) : goalSlug(name) } : {}) }))
                if (click && !slugEdited && !usedBy) setFieldErrors(current => ({ ...current, slug: clickGoalSlug(name) ? undefined : C.slugRule }))
              }} />
              {!click ? <><TextInput id="xp-goal-slug" label={C.slug} required value={draft.slug} readOnly={usedBy > 0}
                help={usedBy ? C.slugLocked : C.slugHelp} error={fieldErrors.slug}
                onChange={event => { setSlugEdited(true); set('slug', event.currentTarget.value) }} /></> : null}
              <Select id="xp-goal-source" label={C.source} required value={click ? 'click:' : draft.source} disabled={usedBy > 0} help={usedBy ? C.sourceLocked : hint || undefined} error={fieldErrors.source} onChange={event => {
                const sourceId = event.currentTarget.value
                const revenue = sourceFor(sourceId, surface.metricSources)?.kind === 'revenue'
                setDraft(current => ({ ...current, source: sourceId, ...(!slugEdited && !usedBy ? { slug: sourceId === 'click:' ? clickGoalSlug(current.name) : goalSlug(current.name) } : {}), capType: revenue ? 'percentile' : '', capValue: revenue ? '0.99' : '' }))
                if (sourceId === 'click:' && !slugEdited && !usedBy) setFieldErrors(current => ({ ...current, slug: clickGoalSlug(draft.name) ? undefined : C.slugRule }))
              }}><option value="">{C.chooseSource}</option>{options.map(option => <option key={option.value} value={option.value}>{option.value === 'click:' ? sourceFor(option.value, surface.metricSources)?.label : option.label}</option>)}
                {!click && draft.source && !options.some(option => option.value === draft.source) ? <option value={draft.source}>{draft.source}</option> : null}
              </Select>
              {!click ? <Select id="xp-goal-direction" label={C.direction} value={draft.direction} error={fieldErrors.direction} onChange={event => set('direction', event.currentTarget.value as Draft['direction'])}>
                <option value="increase">{C.increase}</option><option value="decrease">{C.decrease}</option>
              </Select> : null}
              <NumberInput id="xp-goal-window" label={C.window} required min="1" step="any" value={draft.attributionWindowHours ?? ''} error={fieldErrors.attributionWindowHours}
                onChange={event => set('attributionWindowHours', event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} />
              <NumberInput id="xp-goal-minimum" label={C.minimum} required min="1" step="any" value={draft.minSampleSize ?? ''} error={fieldErrors.minSampleSize}
                onChange={event => set('minSampleSize', event.currentTarget.value === '' ? null : Number(event.currentTarget.value))} />
              <details className="xp-goal-advanced" open={advancedOpen} onToggle={event => setAdvancedOpen(event.currentTarget.open)}><summary>{C.advanced}</summary>
                <div className="xp-goal-advanced-fields">
                  {click ? <><TextInput id="xp-goal-slug" label={C.slug} required value={draft.slug} readOnly={usedBy > 0}
                help={usedBy ? C.slugLocked : C.slugHelp} error={fieldErrors.slug}
                onChange={event => { setSlugEdited(true); set('slug', event.currentTarget.value) }} /></> : <fieldset><legend>{C.capping}</legend>
                    <Select id="xp-goal-cap-type" label={C.capType} required={source?.kind === 'revenue'} value={draft.capType} error={fieldErrors.capType} onChange={event => {
                      const capType = event.currentTarget.value as Draft['capType']
                      setDraft(current => ({ ...current, capType, capValue: capType ? current.capValue : '' }))
                    }}>{source?.kind !== 'revenue' ? <option value="">{C.noCap}</option> : null}<option value="percentile">{C.percentile}</option><option value="absolute">{C.absolute}</option></Select>
                    <NumberInput id="xp-goal-cap-value" label={C.capValue} step="any" min="0" disabled={!draft.capType} value={draft.capValue}
                      error={fieldErrors.capValue} help={C.capHelp} onChange={event => set('capValue', event.currentTarget.value)} />
                  </fieldset>}
                  <NumberInput id="xp-goal-threshold" label={C.threshold} min="0" step="any" value={draft.warningPercent} error={fieldErrors.warningPercent}
                    onInvalid={() => setFieldErrors(current => ({ ...current, warningPercent: C.thresholdError }))} onChange={event => set('warningPercent', event.currentTarget.value)} />
                </div>
              </details>
            </fieldset>
            <div className="xp-ui-button-group">
              <Button variant="primary" type="submit" disabled={pending !== null || !surface.canManage} busy={pending === 'save'}>{pending === 'save' ? C.saving : C.save}</Button>
              <Button variant="quiet" href={listUrl}>{C.cancel}</Button>
              {id === undefined ? null : <Button variant="danger" disabled={pending !== null || usedBy > 0 || !surface.canManage} aria-describedby={usedBy ? 'xp-goal-used' : undefined}
                onClick={() => setConfirmDelete(true)}>{pending === 'delete' ? C.deleting : C.remove}</Button>}
            </div>
            {id !== undefined && usedBy ? <p className="xp-ui-help" id="xp-goal-used">{goalDeleteLocked(usedBy)}</p> : null}
          </Card>
        </form>}
      <Dialog open={confirmDelete} initialFocus="cancel" title={C.deleteTitle} onClose={() => setConfirmDelete(false)}>
        <p>{C.deleteBody}</p>
        <div className="xp-ui-button-group">
          <Button variant="quiet" data-dialog-cancel onClick={() => setConfirmDelete(false)}>{C.cancel}</Button>
          <Button variant="danger" disabled={pending !== null} onClick={() => void remove()}>{C.confirmDelete}</Button>
        </div>
      </Dialog>
    </div>
  </SurfaceShell>
}

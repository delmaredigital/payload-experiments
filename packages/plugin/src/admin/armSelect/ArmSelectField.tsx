'use client'
import { fetchAllDocs } from '../../lib/fetchAllDocs.js'
import { Banner, Button, SelectInput, useConfig, useField } from '@payloadcms/ui'
import { useEffect, useState } from 'react'
import type { GroupFieldClientProps } from 'payload'
import type { ArmSelectExperiment, ExperimentReference } from './armSelect.model.js'
import { bindArmSelect, experimentId } from './armSelect.model.js'
import { ARM_SELECT_COPY } from '../copy/armSelect.js'

/** Only authored copy reaches the field; transport or parse errors read as unavailable. */
const knownCopy = (reason: unknown): string => reason instanceof Error && (Object.values(ARM_SELECT_COPY) as unknown[]).includes(reason.message)
  ? reason.message : ARM_SELECT_COPY.unavailable

type Loaded = { key: string; live: ArmSelectExperiment | null; candidates: ArmSelectExperiment[] }
export function ArmSelectField({ path, field, readOnly }: GroupFieldClientProps) {
  const { config } = useConfig()
  const api = config.routes.api
  const point = String(field.admin?.custom?.flagPoint ?? '')
  const key = `${api}:${point}`
  const experiment = useField<ExperimentReference | null>({ path: `${path}.experiment` })
  const arm = useField<string | null>({ path: `${path}.arm` })
  const storedId = experimentId(experiment.value)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<{ key: string; message: string } | null>(null)
  const [earlier, setEarlier] = useState<{ key: string; id: string; name: string } | null>(null)
  const locked = Boolean(readOnly || field.admin?.readOnly)
  useEffect(() => {
    setLoaded(null)
    setError(null)
    if (!point) return
    const controller = new AbortController()
    async function list(statuses: string): Promise<ArmSelectExperiment[]> {
      const query = new URLSearchParams({ depth: '0',
        'where[flagPoint][equals]': point, 'where[status][in]': statuses })
      const response = await fetchAllDocs<ArmSelectExperiment>(`${api}/xp-experiments?${query}`, { credentials: 'include', signal: controller.signal })
      if (!response.ok) throw new Error(response.status === 403 ? ARM_SELECT_COPY.forbidden : ARM_SELECT_COPY.unavailable)
      return response.docs
    }
    void Promise.all([list('running,decided'), list('draft,stopped')]).then(([live, candidates]) => {
      if (!controller.signal.aborted) { setError(null); setLoaded({ key, live: live[0] ?? null, candidates }) }
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError({ key, message: knownCopy(reason) })
    })
    return () => controller.abort()
  }, [api, point, key])
  const data = loaded?.key === key && error?.key !== key ? loaded : null
  const known = data && storedId != null && [data.live, ...data.candidates].some(doc => doc && String(doc.id) === String(storedId))
  useEffect(() => {
    if (!point || !data || storedId == null || known) return
    const controller = new AbortController()
    void fetch(`${api}/xp-experiments/${encodeURIComponent(storedId)}?depth=0`, { credentials: 'include', signal: controller.signal })
      .then(async response => {
        if (!response.ok) return
        const doc = await response.json() as { name: string }
        if (!controller.signal.aborted) setEarlier({ key, id: String(storedId), name: doc.name })
      }).catch(() => { /* A missing or inaccessible earlier experiment must not hide the current picker. */ })
    return () => controller.abort()
  }, [api, data, key, known, point, storedId])
  if (!point) return <p role="status">{ARM_SELECT_COPY.noFlagPoint}</p>
  if (error?.key === key) return <p role="status">{error.message}</p>
  if (!data) return <p role="status">{ARM_SELECT_COPY.loading}</p>
  const reference = earlier?.key === key && earlier.id === String(storedId)
    ? { id: storedId!, name: earlier.name } : experiment.value
  const binding = bindArmSelect({ ...data, stored: { experiment: reference, arm: arm.value } })
  const write = (id: ArmSelectExperiment['id'] | null, value: string | null) => {
    if (!locked) { experiment.setValue(id == null ? null : String(id)); arm.setValue(value) }
  }
  return <div className="xp-arm-select">
    {binding.banner ? <Banner>{binding.banner}</Banner> : null}
    {binding.stale ? <div><p>{binding.stale}</p><Button disabled={locked} onClick={() => write(null, null)}>{ARM_SELECT_COPY.clear}</Button></div> : null}
    {binding.pickable ? <SelectInput path={`${path}.experiment`} name={`${path}.experiment`} label={ARM_SELECT_COPY.experiment}
      options={data.candidates.map(doc => ({ label: doc.name, value: String(doc.id) }))}
      value={binding.bound ? String(binding.bound.id) : ''} readOnly={locked}
      onChange={option => {
        if (Array.isArray(option)) return
        const candidate = data.candidates.find(doc => String(doc.id) === option?.value)
        write(candidate?.id ?? null, null)
      }} /> : null}
    <SelectInput path={`${path}.arm`} name={`${path}.arm`} label={ARM_SELECT_COPY.group}
      required={field.fields.some(child => 'name' in child && child.name === 'arm' && 'required' in child && child.required)}
      options={binding.options} readOnly={locked || !binding.bound}
      value={!binding.stale && binding.options.some(option => option.value === arm.value) ? arm.value ?? '' : ''}
      onChange={option => {
        if (binding.bound && !Array.isArray(option)) write(binding.bound.id, typeof option?.value === 'string' ? option.value : null)
      }} />
    {arm.showError ? <p role="alert">{arm.errorMessage}</p> : null}
  </div>
}

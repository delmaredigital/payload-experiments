'use client'

import { useEffect, useId, useState } from 'react'
import { fetchAllDocs } from '../lib/fetchAllDocs.js'
import type { ExperimentRef } from '../types/puck.js'
import { usePuckRoutes } from './hostContext.js'
import { pickerCopy } from './copy.js'

type ExperimentOption = ExperimentRef & { name: string; updatedAt?: string; status: keyof typeof pickerCopy.statuses }
type LoadState = 'loading' | 'ready' | 'error' | 'forbidden'

function isExperimentOption(value: unknown): value is ExperimentOption {
  if (!value || typeof value !== 'object') return false
  const doc = value as Record<string, unknown>
  return (typeof doc.id === 'string' || typeof doc.id === 'number') &&
    typeof doc.slug === 'string' && typeof doc.name === 'string' &&
    typeof doc.status === 'string' && Object.hasOwn(pickerCopy.statuses, doc.status)
}

export function ExperimentPicker({ value, onChange }: {
  value: ExperimentRef | null
  onChange: (value: ExperimentRef | null) => void
}) {
  const { api } = usePuckRoutes()
  const id = useId()
  const [experiments, setExperiments] = useState<ExperimentOption[]>([])
  const [search, setSearch] = useState('')
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetchAllDocs<unknown>(`${api}/xp-experiments?where[kind][equals]=block&depth=0&sort=id`, {
          credentials: 'include', signal: controller.signal,
        })
        if (!active) return
        if (!response.ok) {
          setState(response.status === 401 || response.status === 403 ? 'forbidden' : 'error')
          return
        }
        setExperiments(response.docs.filter(isExperimentOption).sort((a, b) => (Date.parse(b.updatedAt ?? '') || 0) - (Date.parse(a.updatedAt ?? '') || 0)))
        setState('ready')
      } catch {
        if (active) setState('error')
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [api])

  const selected = value ? String(value.id) : ''
  const query = search.trim().toLocaleLowerCase('en-US')
  const visible = experiments.filter(doc => String(doc.id) === selected ||
    doc.name.toLocaleLowerCase('en-US').includes(query) || doc.slug.toLocaleLowerCase('en-US').includes(query))
  if (state === 'forbidden') return <div className="xp-ui-field">
    <span>{pickerCopy.label}</span><p>{pickerCopy.forbidden}</p>
  </div>
  return <div className="xp-ui-field">
    {experiments.length > 8 ? <div className="xp-ui-field">
      <label htmlFor={`${id}-search`}>{pickerCopy.search}</label>
      <input id={`${id}-search`} type="search" className="xp-ui-input" value={search}
        onChange={event => setSearch(event.currentTarget.value)} />
    </div> : null}
    <label htmlFor={id}>{pickerCopy.label}</label>
    <select id={id} className="xp-ui-input xp-ui-select" value={selected} disabled={state === 'loading'} /* stays enabled on error so a saved experiment can still be unbound */ onChange={event => {
      const experiment = experiments.find(doc => String(doc.id) === event.currentTarget.value)
      onChange(experiment ? { id: experiment.id, slug: experiment.slug } : null)
    }}>
      <option value="">{pickerCopy.none}</option>
      {value && !experiments.some(doc => String(doc.id) === selected) ? <option value={selected}>{value.slug}</option> : null}
      {visible.map(doc => <option key={doc.id} value={String(doc.id)}>{doc.name} · {pickerCopy.statuses[doc.status]}</option>)}
    </select>
    {state === 'loading' ? <div className="xp-ui-banner" role="status"><p>{pickerCopy.loading}</p></div> : null}
    {state === 'error' ? <div className="xp-ui-banner xp-ui-banner--error" role="alert"><p>{pickerCopy[state]}</p></div> : null}
  </div>
}

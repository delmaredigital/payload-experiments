'use client'

import { useEffect, useState } from 'react'
import type { ExperimentRef } from '../types/puck.js'
import { pickerCopy } from './copy.js'

type ExperimentOption = ExperimentRef & { name: string; status: keyof typeof pickerCopy.statuses }
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
  const [experiments, setExperiments] = useState<ExperimentOption[]>([])
  const [state, setState] = useState<LoadState>('loading')

  useEffect(() => {
    let active = true
    const controller = new AbortController()
    async function load() {
      try {
        const response = await fetch('/api/xp-experiments?where[kind][equals]=block&depth=0&limit=100&sort=-updatedAt', {
          credentials: 'include', signal: controller.signal,
        })
        if (!active) return
        if (!response.ok) {
          setState(response.status === 403 ? 'forbidden' : 'error')
          return
        }
        const data: unknown = await response.json()
        if (!active) return
        if (!data || typeof data !== 'object' || !('docs' in data) || !Array.isArray(data.docs)) {
          setState('error')
          return
        }
        setExperiments(data.docs.filter(isExperimentOption))
        setState('ready')
      } catch {
        if (active) setState('error')
      }
    }
    void load()
    return () => { active = false; controller.abort() }
  }, [])

  const selected = value ? String(value.id) : ''
  return <div>
    <select aria-label={pickerCopy.label} value={selected} disabled={state !== 'ready'} onChange={event => {
      const experiment = experiments.find(doc => String(doc.id) === event.currentTarget.value)
      onChange(experiment ? { id: experiment.id, slug: experiment.slug } : null)
    }}>
      <option value="">{pickerCopy.none}</option>
      {value && !experiments.some(doc => String(doc.id) === selected) ? <option value={selected}>{value.slug}</option> : null}
      {experiments.map(doc => <option key={doc.id} value={String(doc.id)}>{doc.name} · {pickerCopy.statuses[doc.status]}</option>)}
    </select>
    {state === 'loading' ? <p role="status">{pickerCopy.loading}</p> : null}
    {state === 'error' || state === 'forbidden' ? <p role="alert">{pickerCopy[state]}</p> : null}
  </div>
}

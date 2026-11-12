import { createElement, type ReactNode } from 'react'
import type { CustomField } from '@puckeditor/core'
import type { ExperimentRef } from '../types/puck.js'
import { ExperimentPicker } from './ExperimentPicker.js'
import { resolvePuckRoutes, type PuckRoutes } from './routes.js'
import { PuckHostProvider } from './hostContext.js'
import { pickerCopy } from './copy.js'

export function createExperimentSlotField(opts?: { label?: string; routes?: PuckRoutes; renderActions?: (experiment: ExperimentRef) => ReactNode; onBind?: (previous: ExperimentRef | null, next: ExperimentRef | null) => void }): CustomField<ExperimentRef | null> {
  const routes = resolvePuckRoutes(opts?.routes)
  return {
    type: 'custom',
    label: opts?.label ?? pickerCopy.label,
    render: ({ value, onChange }) => createElement(PuckHostProvider, { routes,
      children: createElement('div', { className: 'xp-puck-field' }, ...(opts?.renderActions ? [createElement(ExperimentPicker, { value, onChange: next => { opts?.onBind?.(value, next); onChange(next) } }), value ? opts.renderActions(value) : null] : [createElement(ExperimentPicker, { value, onChange })])),
    }),
  }
}

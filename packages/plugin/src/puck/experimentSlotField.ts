import { createElement } from 'react'
import type { CustomField } from '@puckeditor/core'
import type { ExperimentRef } from '../types/puck.js'
import { ExperimentPicker } from './ExperimentPicker.js'
import { resolvePuckRoutes, type PuckRoutes } from './routes.js'
import { PuckHostProvider } from './hostContext.js'
import { pickerCopy } from './copy.js'

export function createExperimentSlotField(opts?: { label?: string; routes?: PuckRoutes }): CustomField<ExperimentRef | null> {
  const routes = resolvePuckRoutes(opts?.routes)
  return {
    type: 'custom',
    label: opts?.label ?? pickerCopy.label,
    render: ({ value, onChange }) => createElement(PuckHostProvider, { routes, children: createElement(ExperimentPicker, { value, onChange }) }),
  }
}

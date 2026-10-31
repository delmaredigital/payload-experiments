import { createElement } from 'react'
import type { CustomField } from '@puckeditor/core'
import type { ExperimentRef } from '../types/puck.js'
import { ExperimentPicker } from './ExperimentPicker.js'
import { pickerCopy } from './copy.js'

export function createExperimentSlotField(opts?: { label?: string }): CustomField<ExperimentRef | null> {
  return {
    type: 'custom',
    label: opts?.label ?? pickerCopy.label,
    render: ({ value, onChange }) => createElement(ExperimentPicker, { value, onChange }),
  }
}

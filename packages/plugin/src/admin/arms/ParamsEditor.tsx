'use client'

import { CheckboxInput, SelectInput, TextareaInput, TextInput } from '@payloadcms/ui'
import type { ParamField } from '../../types/contracts.js'
import { paramIssue, setParam } from './params.model.js'

export const numberInputStyle = {
  background: 'var(--theme-input-bg)', color: 'var(--theme-text)', border: '1px solid var(--theme-elevation-150)',
  borderRadius: 'var(--style-radius-s)', padding: '0.65rem', width: '100%',
} as const

export function ParamsEditor({ fields, value, path, readOnly, onChange }: {
  fields: Record<string, ParamField>; value: Record<string, unknown>; path: string; readOnly: boolean
  onChange: (value: Record<string, unknown>) => void
}) {
  return <div className="xp-params-editor">{Object.entries(fields).map(([key, field]) => {
    const fieldPath = `${path}.${key}`
    const change = (next: unknown) => { if (!readOnly) onChange(setParam(value, key, field, next)) }
    const issue = paramIssue(field, value[key])
    const shared = { path: fieldPath, label: field.label, required: field.required, readOnly }
    const text = typeof value[key] === 'string' ? value[key] : ''
    return <div key={key}>
      {field.type === 'number' ? <label htmlFor={fieldPath}>{field.label}<input id={fieldPath} name={fieldPath} type="number"
        style={numberInputStyle} required={field.required} disabled={readOnly} min={field.min} max={field.max} step="any"
        value={typeof value[key] === 'number' && Number.isFinite(value[key]) ? value[key] as number : ''}
        aria-invalid={!!issue} onChange={event => change(event.target.value)} /></label>
        : field.type === 'checkbox' ? <CheckboxInput {...shared} name={fieldPath} checked={value[key] === true} onToggle={event => change(event.target.checked)} />
        : field.type === 'select' ? <SelectInput {...shared} name={fieldPath} options={field.options ?? []} value={text}
          onChange={option => change(!Array.isArray(option) ? option?.value ?? '' : '')} />
        : field.type === 'textarea' ? <TextareaInput {...shared} value={text} onChange={event => change(event.target.value)} />
        : <TextInput hasMany={false} {...shared} value={text} onChange={event => change(event.target.value)} />}
      {issue ? <p role="alert">{issue}</p> : null}
    </div>
  })}</div>
}

'use client'
import { FieldError, SelectInput, TextInput, useField, useFormFields } from '@payloadcms/ui'
import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'
import type { JSONFieldClientProps } from 'payload'
import type { SerializedAttributeKeys } from '../../types/admin.js'
import type { Status } from '../../types/contracts.js'
import { isEditable } from '../../collections/experiments/editability.js'
import { isOpValid } from '../../targeting/ops.js'
import type { TargetingOp } from '../../targeting/ops.js'
import { WHO_COPY } from '../copy/who.js'
import { coerceValue, emptyListHint, rowPath, valueInput } from './targeting.model.js'

// Preserve an unfinished comma list while the form receives its typed JSON value.
function CommaList({ path, value, setValue, readOnly, required }: {
  path: string; value: unknown; setValue: (value: unknown) => void; readOnly: boolean; required?: boolean
}) {
  const formatted = Array.isArray(value) ? value.join(', ') : String(value ?? '')
  const [text, setText] = useState(formatted)
  const lastWritten = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (JSON.stringify(value) !== lastWritten.current) setText(formatted)
  }, [value, formatted])
  return <TextInput path={path} label={WHO_COPY.value} value={text} readOnly={readOnly} required={required}
    onChange={(event: ChangeEvent<HTMLInputElement>) => {
      if (readOnly) return
      setText(event.target.value)
      const next = coerceValue('string', 'in', event.target.value)
      lastWritten.current = JSON.stringify(next)
      setValue(next)
    }} />
}

export function TargetingValueField({ path, field, readOnly }: JSONFieldClientProps) {
  const { value, setValue } = useField<unknown>({ path })
  const row = rowPath(path)
  const attribute = useFormFields(([fields]) => fields[`${row}.attribute`]?.value) as string | undefined
  const op = useFormFields(([fields]) => fields[`${row}.op`]?.value) as string | undefined
  const status = useFormFields(([fields]) => fields.status?.value ?? 'draft') as Status
  const keys = (field.admin?.custom?.attributeKeys ?? {}) as SerializedAttributeKeys
  const definition = keys[attribute ?? '']
  const candidate = op ?? ''
  const valid = Boolean(definition && isOpValid(definition.type, candidate))
  const operator: TargetingOp = definition && isOpValid(definition.type, candidate) ? candidate : 'eq'
  const input = valueInput(definition, operator)
  const locked = Boolean(readOnly || field.admin?.readOnly || !isEditable(status, 'targeting') || !valid)
  const type = definition?.type
  useEffect(() => {
    if (locked || !type || !isOpValid(type, candidate) || value == null) return
    const next = coerceValue(type, candidate, value)
    if (JSON.stringify(next) !== JSON.stringify(value)) setValue(next)
  }, [type, candidate, value, locked, setValue])
  const write = (raw: unknown) => {
    if (!locked && definition && isOpValid(definition.type, operator)) setValue(coerceValue(definition.type, operator, raw))
  }
  const many = operator === 'in' || operator === 'nin'
  const hint = emptyListHint(operator, value)
  const props = { path, label: WHO_COPY.value, readOnly: locked, required: field.required }
  return <div>
    {input.kind === 'select' || input.kind === 'multiselect' || input.kind === 'boolean'
      ? <SelectInput {...props} name={path} hasMany={input.kind === 'multiselect'}
          options={input.kind === 'boolean' ? [{ label: WHO_COPY.true, value: 'true' }, { label: WHO_COPY.false, value: 'false' }] : input.options}
          value={many ? (Array.isArray(value) ? value.map(String) : []) : value == null ? '' : String(value)}
          onChange={option => write(Array.isArray(option) ? option.map(item => item.value) : option?.value)} />
      : input.kind === 'number'
        ? <><label htmlFor={path}>{WHO_COPY.value}</label><input id={path} name={path} type="number" step="any"
            required={field.required} readOnly={locked} value={typeof value === 'number' || typeof value === 'string' ? value : ''}
            style={{ display: 'block', color: 'var(--theme-text)', background: 'var(--theme-input-bg)', border: '1px solid var(--theme-elevation-200)', padding: '0.5rem' }}
            onChange={event => write(event.target.value)} /><FieldError path={path} /></>
        : many ? <CommaList key={`${path}:${attribute}:${operator}`} {...props} value={value} setValue={write} />
          : <TextInput {...props} value={typeof value === 'string' ? value : ''} onChange={(event: ChangeEvent<HTMLInputElement>) => write(event.target.value)} />}
    {definition?.type === 'string' ? <p>{WHO_COPY.caseNote}</p> : null}
    {many && input.kind === 'text' ? <p>{WHO_COPY.listNote}</p> : null}
    {hint ? <p>{hint}</p> : null}
  </div>
}

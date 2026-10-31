'use client'
import { SelectInput, useField, useFormFields } from '@payloadcms/ui'
import { useEffect, useRef } from 'react'
import type { TextFieldClientProps } from 'payload'
import type { SerializedAttributeKeys } from '../../types/admin.js'
import type { Status } from '../../types/contracts.js'
import { isEditable } from '../../collections/experiments/editability.js'
import { isOpValid } from '../../targeting/ops.js'
import { WHO_COPY } from '../copy/who.js'
import { opLabel, opsFor, rowPath } from './targeting.model.js'

export function TargetingOpField({ path, field, readOnly }: TextFieldClientProps) {
  const { value, setValue } = useField<string>({ path })
  const row = rowPath(path)
  const attribute = useFormFields(([fields]) => fields[`${row}.attribute`]?.value) as string | undefined
  const status = useFormFields(([fields]) => fields.status?.value ?? 'draft') as Status
  const keys = (field.admin?.custom?.attributeKeys ?? {}) as SerializedAttributeKeys
  const type = keys[attribute ?? '']?.type
  const previousType = useRef(type)
  const locked = Boolean(readOnly || field.admin?.readOnly || !isEditable(status, 'targeting'))
  useEffect(() => {
    const changed = previousType.current !== type
    previousType.current = type
    if (!locked && type && (changed || !isOpValid(type, value ?? ''))) setValue(opsFor(type)[0])
  }, [type, value, locked, setValue])
  return <SelectInput path={path} name={path} label={WHO_COPY.operator} required={field.required}
    options={opsFor(type).map(op => ({ label: opLabel(type!, op), value: op }))}
    value={value ?? ''} readOnly={locked || !type}
    onChange={option => { if (!locked) setValue(option && !Array.isArray(option) ? option.value : null) }} />
}

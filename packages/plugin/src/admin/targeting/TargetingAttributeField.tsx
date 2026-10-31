'use client'
import { SelectInput, useField, useFormFields } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import type { SerializedAttributeKeys } from '../../types/admin.js'
import type { Status } from '../../types/contracts.js'
import { isEditable } from '../../collections/experiments/editability.js'
import { WHO_COPY } from '../copy/who.js'
import { humaniseAttribute } from './targeting.model.js'

export function TargetingAttributeField({ path, field, readOnly }: TextFieldClientProps) {
  const { value, setValue } = useField<string>({ path })
  const status = useFormFields(([fields]) => fields.status?.value ?? 'draft') as Status
  const keys = (field.admin?.custom?.attributeKeys ?? {}) as SerializedAttributeKeys
  const locked = Boolean(readOnly || field.admin?.readOnly || !isEditable(status, 'targeting'))
  return <div>
    <SelectInput path={path} name={path} label={WHO_COPY.attribute} required={field.required}
      options={Object.keys(keys).map(key => ({ label: humaniseAttribute(key), value: key }))}
      value={value ?? ''} readOnly={locked}
      onChange={option => { if (!locked) setValue(option && !Array.isArray(option) ? option.value : null) }} />
  </div>
}

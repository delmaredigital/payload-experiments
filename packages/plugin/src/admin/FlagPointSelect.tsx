'use client'

import { SelectInput, useField, useForm, useFormFields } from '@payloadcms/ui'
import type { TextFieldClientProps } from 'payload'
import type { SerializedFlagPoint } from '../types/admin.js'
import type { Status } from '../types/contracts.js'
import { EDITABLE_BY_STATUS, isEditable } from '../collections/experiments/editability.js'
import { lockedReason } from './lockedNotice.model.js'
import { ARMS_COPY } from './copy/arms.js'
import { readArms } from './arms/arms.model.js'

export function FlagPointSelect({ field, path, readOnly }: TextFieldClientProps) {
  const { value, setValue } = useField<string>({ path })
  const form = useForm()
  const status = useFormFields(([fields]) => (fields.status?.value ?? 'draft') as Status)
  const rowKinds = useFormFields(([fields]) => readArms(fields).map(arm => arm.kind).join(','))
  const points = (field.admin?.custom?.flagPoints ?? []) as SerializedFlagPoint[]
  const editable = isEditable(status, 'flagPoint') && !readOnly && !form.disabled
  const reason = lockedReason(status, 'flagPoint', EDITABLE_BY_STATUS)
  return <div className="xp-flag-point">
    <SelectInput path={path} name={path} label={ARMS_COPY.flagPoint} options={points.map(point => ({ label: point.label, value: point.id }))}
      value={value ?? ''} readOnly={!editable} onChange={option => {
        if (!editable || Array.isArray(option)) return
        const point = points.find(candidate => candidate.id === option?.value)
        if ((point?.id ?? '') === (value ?? '')) return
        setValue(point?.id ?? '')
        rowKinds.split(',').forEach((kind, index) => {
          if (kind === 'control' || kind === 'variant') form.dispatchFields({ type: 'UPDATE', path: `arms.${index}.params`,
            value: kind === 'control' && point ? { ...point.effectiveDefaults } : {} })
        })
        form.setModified(true)
      }} />
    {reason ? <p className="xp-locked-notice">{reason}</p> : null}
  </div>
}

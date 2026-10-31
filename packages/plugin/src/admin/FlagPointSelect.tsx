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
  const { status, controlIndex } = useFormFields(([fields]) => ({
    status: (fields.status?.value ?? 'draft') as Status,
    controlIndex: readArms(fields).findIndex(arm => arm.kind === 'control'),
  }))
  const points = (field.admin?.custom?.flagPoints ?? []) as SerializedFlagPoint[]
  const editable = isEditable(status, 'flagPoint') && !readOnly && !form.disabled
  const reason = lockedReason(status, 'flagPoint', EDITABLE_BY_STATUS)
  return <div className="xp-flag-point">
    <SelectInput path={path} name={path} label={ARMS_COPY.flagPoint} options={points.map(point => ({ label: point.label, value: point.id }))}
      value={value ?? ''} readOnly={!editable} onChange={option => {
        if (!editable || Array.isArray(option)) return
        const point = points.find(candidate => candidate.id === option?.value)
        setValue(point?.id ?? '')
        if (controlIndex >= 0) form.dispatchFields({ type: 'UPDATE', path: `arms.${controlIndex}.params`, value: point ? { ...point.effectiveDefaults } : {} })
        form.setModified(true)
      }} />
    {reason ? <p className="xp-locked-notice">{reason}</p> : null}
  </div>
}

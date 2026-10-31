'use client'
import { FieldError, useField, useFormFields } from '@payloadcms/ui'
import type { NumberFieldClientProps } from 'payload'
import type { Status, UnitType } from '../types/contracts.js'
import { EDITABLE_BY_STATUS, isEditable } from '../collections/experiments/editability.js'
import { lockedReason } from './lockedNotice.model.js'
import { allocationGroups, allocationLayer, allocationSentence } from './allocation.model.js'
import { WHO_COPY } from './copy/who.js'

export function AllocationField({ path, field, readOnly }: NumberFieldClientProps) {
  const { value, setValue } = useField<number | null>({ path })
  const form = useFormFields(([fields]) => ({
    status: (fields.status?.value ?? 'draft') as Status,
    unitType: (fields.unitType?.value ?? 'visitor') as UnitType,
    arms: allocationGroups(fields),
    layer: allocationLayer(fields.layer?.value) ?? allocationLayer({
      name: fields['layer.name']?.value, used: fields['layer.used']?.value, free: fields['layer.free']?.value,
    }),
  }))
  const locked = Boolean(readOnly || field.admin?.readOnly || !isEditable(form.status, 'allocation'))
  const reason = lockedReason(form.status, 'allocation', EDITABLE_BY_STATUS)
  const sentence = allocationSentence({ ...form, allocation: value ?? NaN })
  // position: relative anchors Payload's absolutely positioned FieldError tooltip to this field.
  return <div className="xp-allocation-field" style={{ position: 'relative' }}>
    <label htmlFor={path}>{WHO_COPY.allocation}</label>
    <input id={path} name={path} type="number" min={1} max={100} step={1} required={field.required}
      value={value ?? ''} readOnly={locked} aria-describedby={`${path}-description`}
      style={{ display: 'block', color: 'var(--theme-text)', background: 'var(--theme-input-bg)', border: '1px solid var(--theme-elevation-200)', borderRadius: 'var(--style-radius-s)', padding: '0.5rem' }}
      onChange={event => { if (!locked) setValue(event.target.value === '' ? null : event.target.valueAsNumber) }} />
    <FieldError path={path} />
    <p id={`${path}-description`}>{sentence}</p>
    {reason && (form.status !== 'running' || !sentence) ? <p className="xp-locked-notice">{reason}</p> : null}
  </div>
}

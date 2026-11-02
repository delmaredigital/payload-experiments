'use client'

import { useId, useState } from 'react'
import { CheckboxInput, TextareaInput, TextInput } from '@payloadcms/ui'
import { EDITABLE_BY_STATUS, isEditable } from '../../../collections/experiments/editability.js'
import type { ParamField } from '../../../types/contracts.js'
import { coerceParam, paramIssue, paramsForArm, setParam } from '../../arms/params.model.js'
import { SETTING_COPY } from '../../copy/setting.js'
import { lockedReason } from '../../lockedNotice.model.js'
import type { KindParts, SectionProps } from '../contracts.js'
import { bindSetting, displayParam, paramCheckMessage, paramControl } from './setting.model.js'
import './setting.css'

function Binding({ test, surface }: SectionProps) {
  const id = useId()
  const doc = test.doc
  if (!doc) return null
  const point = surface.flagPoints.find(point => point.id === doc.flagPoint)
  const editable = surface.canManage && isEditable(doc.status, 'flagPoint')
  const reason = lockedReason(doc.status, 'flagPoint', EDITABLE_BY_STATUS)
  return <div className="xp-setting-binding">
    {editable ? <label htmlFor={id}>{SETTING_COPY.setting}: {point?.label}
      <select id={id} value={point?.id ?? ''} aria-describedby={`${id}-description`} onChange={event => {
        const current = test.doc
        if (!current || !surface.canManage || !isEditable(current.status, 'flagPoint') || event.target.value === current.flagPoint) return
        const next = surface.flagPoints.find(point => point.id === event.target.value)
        test.stage({ flagPoint: next?.id ?? '', arms: bindSetting(current.arms, next) })
        void test.commit()
      }}>
        <option value="">{SETTING_COPY.choose}</option>
        {surface.flagPoints.map(point => <option key={point.id} value={point.id}>{point.label}</option>)}
      </select>
    </label> : <p title={reason ?? undefined}>{SETTING_COPY.setting}: {point?.label ?? SETTING_COPY.choose}</p>}
    <p id={`${id}-description`}>{point?.description ?? point?.label ?? SETTING_COPY.choose}</p>
    {reason ? <p className="xp-setting-lock">{reason}</p> : null}
    {test.errors.flagPoint ? <p role="alert">{test.errors.flagPoint}</p> : null}
  </div>
}

type ValueProps = SectionProps & { armIndex: number; paramKey: string; field: ParamField }

function Parameter({ test, surface, armIndex, paramKey, field }: ValueProps) {
  const id = useId()
  // Only the edited scalar stays local; the complete group is rebuilt on commit.
  const [draft, setDraft] = useState<{ value: unknown } | null>(null)
  const doc = test.doc
  const arm = doc?.arms[armIndex]
  if (!doc || !arm) return null
  const point = surface.flagPoints.find(point => point.id === doc.flagPoint)
  const value = draft ? draft.value : paramsForArm(arm, point)[paramKey]
  const path = `arms.${armIndex}.params.${paramKey}`
  const editable = surface.canManage && isEditable(doc.status, 'arms')
  const reason = lockedReason(doc.status, 'arms', EDITABLE_BY_STATUS)
  const failed = test.preflight?.checks.find(check => check.code === 'flag-params-invalid' && !check.ok)
  const error = test.errors[path] ?? test.errors[`arms.${armIndex}.params`] ?? test.errors.arms
  const issue = (error === 'flag-params-invalid' ? SETTING_COPY.invalid.replace('{label}', field.label) : error)
    ?? paramIssue(field, draft ? coerceParam(field, value) : value) ?? paramCheckMessage(failed?.detail, arm.key, paramKey, field)

  const save = (next: unknown) => {
    const current = test.doc
    const currentArm = current?.arms[armIndex]
    if (!current || currentArm?.kind !== 'variant' || currentArm.key !== arm.key || !surface.canManage ||
      !isEditable(current.status, 'arms') || current.flagPoint !== point?.id) return
    const arms = current.arms.map((item, index) => index === armIndex
      ? { ...item, params: setParam(paramsForArm(item, point), paramKey, field, next) } : item)
    test.stage({ arms })
    void test.commit()
  }
  const blur = () => {
    if (draft) { save(draft.value); setDraft(null) }
  }
  const control = paramControl(field)
  const shared = { id, path: id, label: field.label, required: field.required }
  const text = typeof value === 'string' ? value : ''
  return <div className="xp-setting-parameter" onBlur={blur}>
    {arm.kind === 'control' || !editable ? <div title={reason ?? undefined}>
      <span>{field.label}</span>
      <p className="xp-setting-value">{arm.kind === 'control'
        ? SETTING_COPY.current.replace('{value}', displayParam(field, point?.effectiveDefaults[paramKey]))
        : displayParam(field, value)}</p>
      {reason ? <p className="xp-setting-lock">{reason}</p> : null}
    </div> : control === 'checkbox' ? <CheckboxInput {...shared} name={id} checked={value === true}
      onToggle={event => save(event.target.checked)} />
      : control === 'segmented' ? <fieldset aria-describedby={issue ? `${id}-error` : undefined}>
        <legend>{field.label}</legend>
        <div className="xp-setting-segments">{field.options?.map(option => <label key={option.value}>
          <input type="radio" name={id} value={option.value} checked={value === option.value} required={field.required}
            onChange={() => save(option.value)} />
          <span>{option.label}</span>
        </label>)}</div>
      </fieldset>
      : control === 'select' ? <label htmlFor={id}>{field.label}<select id={id} value={text} required={field.required}
        aria-invalid={!!issue} aria-describedby={issue ? `${id}-error` : undefined} onChange={event => save(event.target.value)}>
        <option value="">{SETTING_COPY.empty}</option>
        {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select></label>
      : control === 'number' ? <label htmlFor={id}>{field.label}<input id={id} type="number" min={field.min} max={field.max}
        step="any" required={field.required} value={typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' ? value : ''}
        aria-invalid={!!issue} aria-describedby={issue ? `${id}-error` : undefined} onChange={event => setDraft({ value: event.target.value })} /></label>
      : control === 'textarea' ? <TextareaInput {...shared} showError={!!issue} value={text} onChange={event => setDraft({ value: event.target.value })} />
      : <TextInput {...shared} showError={!!issue} hasMany={false} value={text} onChange={event => setDraft({ value: event.target.value })} />}
    {issue ? <p id={`${id}-error`} role="alert">{issue}</p> : null}
  </div>
}

function VersionContent({ test, surface, armIndex }: SectionProps & { armIndex: number }) {
  const doc = test.doc
  const arm = doc?.arms[armIndex]
  if (!doc || !arm) return null
  if (arm.kind === 'holdout') return <p>{SETTING_COPY.holdout}</p>
  const point = surface.flagPoints.find(point => point.id === doc.flagPoint)
  if (!point) return <p>{SETTING_COPY.choose}</p>
  return <div className="xp-setting-values">{Object.entries(point.params).map(([key, field]) =>
    <Parameter key={`${doc.id}:${point.id}:${arm.key}:${key}:${doc.status}:${surface.canManage}`} test={test} surface={surface} armIndex={armIndex} paramKey={key} field={field} />)}</div>
}

export const settingParts: KindParts = { Binding, VersionContent }

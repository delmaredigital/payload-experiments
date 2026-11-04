'use client'

import { useId, useState } from 'react'
import { Checkbox, Textarea, TextInput, NumberInput, Select } from '../../../ui/Inputs.js'
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
    {editable ? <Select id={id} label={SETTING_COPY.setting} value={point?.id ?? ''} aria-describedby={point ? `${id}-description` : undefined} onChange={event => {
        const current = test.doc
        if (!current || !surface.canManage || !isEditable(current.status, 'flagPoint') || event.target.value === current.flagPoint) return
        const next = surface.flagPoints.find(point => point.id === event.target.value)
        if (!next) return
        test.stage({ flagPoint: next.id, arms: bindSetting(current.arms, next) })
        void test.commit()
      }}>
        {!point ? <option value="">{SETTING_COPY.choose}</option> : null}
        {surface.flagPoints.map(point => <option key={point.id} value={point.id}>{point.label}</option>)}
      </Select> : <p title={reason ?? undefined}>{SETTING_COPY.setting}: {point?.label ?? SETTING_COPY.choose}</p>}
    {point ? <p id={`${id}-description`}>{point.description ?? point.label}</p> : null}
    {reason ? <p className="xp-setting-lock">{reason}</p> : null}
    {test.errors.flagPoint ? <p role="alert">{test.errors.flagPoint}</p> : null}
  </div>
}

type ValueProps = SectionProps & { armIndex: number; paramKey: string; field: ParamField }

function Parameter({ test, surface, armIndex, paramKey, field }: ValueProps) {
  const id = useId()
  // Only the edited scalar stays local; the complete group is rebuilt on commit.
  const [draft, setDraft] = useState<{ value: unknown } | null>(null)
  const [touched, setTouched] = useState(false)
  const doc = test.doc
  const arm = doc?.arms[armIndex]
  if (!doc || !arm) return null
  const point = surface.flagPoints.find(point => point.id === doc.flagPoint)
  const value = draft ? draft.value : paramsForArm(arm, point)[paramKey]
  const path = `arms.${armIndex}.params.${paramKey}`
  const editable = surface.canManage && isEditable(doc.status, 'arms')
  const reason = lockedReason(doc.status, 'arms', EDITABLE_BY_STATUS)
  const failed = test.preflight?.checks.find(check => check.code === 'flag-params-invalid' && !check.ok)
  const error = test.errors[path] ?? test.errors[`arms.${armIndex}.params`]
  const preflightIssue = paramCheckMessage(failed?.detail, arm.key, paramKey, field)
  const issue = error ?? (touched || preflightIssue ? paramIssue(field, draft ? coerceParam(field, value) : value) : null) ?? preflightIssue

  const save = (next: unknown) => {
    const current = test.doc
    const currentArm = current?.arms[armIndex]
    if (!current || currentArm?.kind !== 'variant' || currentArm.key !== arm.key || !surface.canManage ||
      !isEditable(current.status, 'arms') || current.flagPoint !== point?.id) return
    setTouched(true)
    const arms = current.arms.map((item, index) => index === armIndex
      ? { ...item, params: setParam(paramsForArm(item, point), paramKey, field, next) } : item)
    test.stage({ arms })
    void test.commit()
  }
  const blur = () => {
    if (draft) { save(draft.value); setDraft(null) }
  }
  const control = paramControl(field)
  const shared = { id, label: field.label, required: field.required }
  const inlineError = issue ? <p id={`${id}-error`} role="alert">{issue}</p> : null
  const editDraft = (value: string) => { setTouched(true); setDraft({ value }) }
  const text = typeof value === 'string' ? value : ''
  return <div className="xp-setting-parameter" onBlur={blur}>
    {arm.kind === 'control' || !editable ? <div title={reason ?? undefined}>
      <span>{field.label}</span>
      <p className="xp-setting-value">{arm.kind === 'control'
        ? SETTING_COPY.current.replace('{value}', displayParam(field, point?.effectiveDefaults[paramKey]))
        : displayParam(field, value)}</p>
      {reason ? <p className="xp-setting-lock">{reason}</p> : null}
    </div> : control === 'checkbox' ? <Checkbox {...shared} error={issue ?? undefined} name={id} checked={value === true}
      onChange={event => save(event.target.checked)} />
      : control === 'segmented' ? <fieldset aria-describedby={issue ? `${id}-error` : undefined}>
        <legend>{field.label}</legend>
        <div className="xp-setting-segments">{field.options?.map(option => <label key={option.value}>
          <input type="radio" name={id} value={option.value} checked={value === option.value} required={field.required}
            onChange={() => save(option.value)} />
          <span>{option.label}</span>
        </label>)}</div>
      </fieldset>
      : control === 'select' ? <Select id={id} label={field.label} value={text} required={field.required}
        error={issue ?? undefined} onChange={event => save(event.target.value)}>
        <option value="">{SETTING_COPY.empty}</option>
        {field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </Select>
      : control === 'number' ? <NumberInput id={id} label={field.label} min={field.min} max={field.max}
        step="any" required={field.required} value={typeof value === 'number' && Number.isFinite(value) || typeof value === 'string' ? value : ''}
        error={issue ?? undefined} onChange={event => editDraft(event.target.value)} />
      : control === 'textarea' ? <Textarea {...shared} error={issue ?? undefined} value={text} onChange={event => editDraft(event.target.value)} />
      : <TextInput {...shared} error={issue ?? undefined} value={text} onChange={event => editDraft(event.target.value)} />}
    {arm.kind === 'control' || !editable || control === 'segmented' ? inlineError : null}
  </div>
}

function VersionContent({ test, surface, armIndex }: SectionProps & { armIndex: number }) {
  const doc = test.doc
  const arm = doc?.arms[armIndex]
  if (!doc || !arm) return null
  if (arm.kind === 'holdout') return <span className="xp-content-chip">{SETTING_COPY.holdout}</span>
  const point = surface.flagPoints.find(point => point.id === doc.flagPoint)
  if (!point) return <p>{SETTING_COPY.choose}</p>
  const ready = Object.entries(point.params).every(([key, field]) => !paramIssue(field, paramsForArm(arm, point)[key]))
  return <div className="xp-setting-values"><span className={`xp-content-chip ${ready ? 'xp-content-ready' : 'xp-content-empty'}`}>{ready ? SETTING_COPY.valuesReady : SETTING_COPY.setValues}</span>{Object.entries(point.params).map(([key, field]) =>
    <Parameter key={`${doc.id}:${point.id}:${arm.key}:${key}:${doc.status}:${surface.canManage}`} test={test} surface={surface} armIndex={armIndex} paramKey={key} field={field} />)}</div>
}

export const settingParts: KindParts = { Binding, VersionContent }

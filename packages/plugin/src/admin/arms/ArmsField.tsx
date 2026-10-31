'use client'

import { Button, TextInput, useForm, useFormFields } from '@payloadcms/ui'
import type { ArrayFieldClientProps, FormState } from 'payload'
import type { Arm, ExperimentKind, Status } from '../../types/contracts.js'
import type { SerializedFlagPoint } from '../../types/admin.js'
import { EDITABLE_BY_STATUS, isEditable } from '../../collections/experiments/editability.js'
import { lockedReason } from '../lockedNotice.model.js'
import { ARMS_COPY, GROUP_LABELS, issueMessage } from '../copy/arms.js'
import { addHoldoutArm, addVariant, ARM_FIELDS, issuesByRow, readArms, removeArm, setWeight, splitEvenly } from './arms.model.js'
import { pageTargetIssue, setPageTarget, showsPageTarget } from './pageTarget.model.js'
import { paramsForArm, paramsReadOnly } from './params.model.js'
import { numberInputStyle, ParamsEditor } from './ParamsEditor.js'

export function ArmsField({ field, path = 'arms', readOnly }: ArrayFieldClientProps) {
  const form = useForm()
  const { arms, kind, status, flagPoint, rowIds, rowMetadata } = useFormFields(([fields]) => ({
    arms: readArms(fields, path), kind: (fields.kind?.value ?? 'block') as ExperimentKind,
    status: (fields.status?.value ?? 'draft') as Status, flagPoint: fields.flagPoint?.value,
    rowIds: readArms(fields, path).map((_, index) => fields[`${path}.${index}.id`]?.value as string | undefined),
    rowMetadata: fields[path]?.rows,
  }))
  const editable = isEditable(status, 'arms') && !readOnly && !form.disabled
  const reason = lockedReason(status, 'arms', EDITABLE_BY_STATUS)
  const points = (field.admin?.custom?.flagPoints ?? []) as SerializedFlagPoint[]
  const point = points.find(candidate => candidate.id === flagPoint)
  const issues = issuesByRow(arms, kind)
  const total = arms.reduce((sum, arm) => sum + arm.weight, 0)

  function apply(next: Arm[]) {
    if (!editable || next === arms) return
    const structureChanged = next.length !== arms.length || next.some((row, index) => row.key !== arms[index]?.key)
    // Array row IDs identify existing groups in the server's immutable-key check.
    // Move both the hidden ID field and public row metadata with the logical key.
    const idsByKey = new Map(arms.map((row, index) => [row.key, rowIds[index]]))
    const nextIds = structureChanged ? next.map(row => idsByKey.get(row.key) ?? crypto.randomUUID()) : rowIds
    for (let rowIndex = arms.length - 1; rowIndex >= next.length; rowIndex--) form.removeFieldRow({ path, rowIndex })
    for (let rowIndex = arms.length; rowIndex < next.length; rowIndex++) {
      const row = next[rowIndex]!
      const subFieldState: FormState = {
        ...Object.fromEntries(ARM_FIELDS.map(key => [key, { value: row[key], initialValue: undefined, valid: true }])),
        id: { value: nextIds[rowIndex], initialValue: undefined, valid: true },
      }
      form.addFieldRow({ path, rowIndex, schemaPath: 'arms', subFieldState })
    }
    next.forEach((row, index) => {
      if (structureChanged && rowIds[index] !== nextIds[index]) form.dispatchFields({ type: 'UPDATE', path: `${path}.${index}.id`, value: nextIds[index] })
      for (const key of ARM_FIELDS) {
        if (!Object.is(arms[index]?.[key], row[key])) form.dispatchFields({ type: 'UPDATE', path: `${path}.${index}.${key}`, value: row[key] })
      }
    })
    if (structureChanged) form.dispatchFields({ type: 'UPDATE', path, rows: nextIds.map(id =>
      rowMetadata?.find(row => row.id === id) ?? { id: id!, isLoading: true }),
    })
    form.setModified(true)
  }
  function update(index: number, patch: Partial<Arm>) {
    apply(arms.map((arm, i) => i === index ? { ...arm, ...patch } : arm))
  }
  return <div className="xp-groups">
    {reason ? <p className="xp-locked-notice">{reason}</p> : null}
    {issues.form.map((issue, i) => <p key={i} role="alert">{issueMessage(issue, total)}</p>)}
    <fieldset disabled={!editable} aria-label={ARMS_COPY.groups} style={{ border: 0, padding: 0, margin: 0 }}>
      {arms.map((arm, index) => {
        const rowPath = `${path}.${index}`
        const pageIssue = showsPageTarget(kind, arm.kind) ? pageTargetIssue(arm.pageTarget, arm.kind) : null
        return <section key={index} className="xp-group" style={{ marginBottom: '1.5rem' }}>
          <h3>{GROUP_LABELS[arm.key] ?? arm.label}</h3>
          <TextInput hasMany={false} path={`${rowPath}.label`} label={ARMS_COPY.label} value={arm.label ?? ''} readOnly={!editable}
            onChange={event => update(index, { label: event.target.value })} />
          <label htmlFor={`${rowPath}.weight`}>{ARMS_COPY.weight}<input id={`${rowPath}.weight`} name={`${rowPath}.weight`}
            type="number" min={0} max={100} step={1} style={numberInputStyle} disabled={!editable}
            value={Number.isFinite(arm.weight) ? arm.weight : ''} onChange={event => apply(setWeight(arms, arm.key, event.target.value === '' ? NaN : Number(event.target.value)))} /></label>
          {kind === 'block' && arm.kind !== 'holdout' ? <p>{ARMS_COPY.slot}: {GROUP_LABELS[arm.key] ?? arm.label}</p> : null}
          {kind === 'page' && arm.kind === 'holdout' ? <p>{ARMS_COPY.holdoutPage}</p> : null}
          {showsPageTarget(kind, arm.kind) ? <TextInput hasMany={false} path={`${rowPath}.pageTarget`} label={ARMS_COPY.pagePath}
            value={arm.pageTarget ?? ''} required readOnly={!editable} onChange={event => {
              const next = setPageTarget(arm, event.target.value)
              update(index, { pageTarget: next.pageTarget })
            }} /> : null}
          {pageIssue ? <p role="alert">{pageIssue}</p> : null}
          {kind === 'flag' && point ? <>
            {arm.kind === 'control' ? <p>{ARMS_COPY.controlParams}</p> : null}
            <ParamsEditor fields={point.params} path={`${rowPath}.params`} value={paramsForArm(arm, point)}
              readOnly={paramsReadOnly(arm, editable)} onChange={params => update(index, { params })} />
          </> : null}
          {issues.rows[index]!.map((issue, i) => <p key={i} role="alert">{issueMessage(issue, total)}</p>)}
          {arm.kind === 'holdout' ? <>
            <p>{ARMS_COPY.holdout}</p>
            <Button onClick={() => apply(removeArm(arms, arm.key))} disabled={!editable}>{ARMS_COPY.removeHoldout}</Button>
          </> : arm.kind === 'variant' ? <Button onClick={() => apply(removeArm(arms, arm.key))} disabled={!editable}>{ARMS_COPY.removeVariant}</Button> : null}
        </section>
      })}
      <Button disabled={!editable || arms.filter(arm => arm.kind === 'variant').length >= 3} onClick={() => apply(addVariant(arms, kind))}>{ARMS_COPY.addVariant}</Button>
      {!arms.some(arm => arm.kind === 'holdout') ? <Button disabled={!editable} onClick={() => apply(addHoldoutArm(arms))}>{ARMS_COPY.addHoldout}</Button> : null}
      <Button disabled={!editable} onClick={() => apply(splitEvenly(arms))}>{ARMS_COPY.splitEvenly}</Button>
    </fieldset>
  </div>
}

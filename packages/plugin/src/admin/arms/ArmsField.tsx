'use client'

import { useEffect, useMemo, useRef } from 'react'
import { Button, TextInput, useField, useForm, useFormFields } from '@payloadcms/ui'
import type { ArrayFieldClientProps, FormState } from 'payload'
import type { Arm, ExperimentKind, Status } from '../../types/contracts.js'
import type { SerializedFlagPoint } from '../../types/admin.js'
import { EDITABLE_BY_STATUS, isEditable } from '../../collections/experiments/editability.js'
import { lockedReason } from '../lockedNotice.model.js'
import { ARMS_COPY, GROUP_LABELS, ISSUE_COPY, issueMessage } from '../copy/arms.js'
import { addHoldoutArm, addVariant, ARM_FIELDS, defaultArms, issuesByRow, readArms, removeArm, setWeight, splitEvenly, totalWeight, withSlotsFor } from './arms.model.js'
import { pageTargetIssue, setPageTarget, showsPageTarget } from './pageTarget.model.js'
import { paramsForArm, paramsReadOnly } from './params.model.js'
import { numberInputStyle, ParamsEditor } from './ParamsEditor.js'

function newRowId(): string {
  if (globalThis.crypto?.getRandomValues) {
    return Array.from(globalThis.crypto.getRandomValues(new Uint8Array(12)), byte => byte.toString(16).padStart(2, '0')).join('')
  }
  return (Date.now().toString(16).padStart(12, '0') + Math.floor(Math.random() * 2 ** 48).toString(16).padStart(12, '0')).slice(-24)
}

export function ArmsField({ field, path = 'arms', readOnly }: ArrayFieldClientProps) {
  const form = useForm()
  const { showError, errorMessage } = useField({ path, hasRows: true })
  const kind = useFormFields(([fields]) => fields.kind?.value as ExperimentKind | undefined)
  const status = useFormFields(([fields]) => (fields.status?.value ?? 'draft') as Status)
  const flagPoint = useFormFields(([fields]) => fields.flagPoint?.value)
  const rowMetadata = useFormFields(([fields]) => fields[path]?.rows)
  // Payload compares selector results by identity. Retain the arm slice when
  // another field changes, including while a cleared weight contains NaN.
  const selectRows = useMemo(() => {
    let previous: { arms: Arm[]; rowIds: (string | undefined)[] } = { arms: [], rowIds: [] }
    return ([fields]: [FormState, unknown]) => {
      const arms = readArms(fields, path)
      const rowIds = arms.map((_, index) => fields[`${path}.${index}.id`]?.value as string | undefined)
      if (arms.length !== previous.arms.length || arms.some((arm, index) =>
        rowIds[index] !== previous.rowIds[index] || ARM_FIELDS.some(key => !Object.is(arm[key], previous.arms[index]?.[key])))) previous = { arms, rowIds }
      return previous
    }
  }, [path])
  const { arms, rowIds } = useFormFields(selectRows)
  const seeded = useRef(false)
  const editable = isEditable(status, 'arms') && !readOnly && !form.disabled
  const reason = lockedReason(status, 'arms', EDITABLE_BY_STATUS)
  const points = (field.admin?.custom?.flagPoints ?? []) as SerializedFlagPoint[]
  const point = points.find(candidate => candidate.id === flagPoint)
  const issues = issuesByRow(arms, kind)
  const total = totalWeight(arms)
  const hasControl = arms.some(arm => arm.kind === 'control')
  const serverCode = [...issues.form, ...issues.rows.flat()].find(issue => issue.message === errorMessage)?.code ??
    (typeof errorMessage === 'string' ? Object.keys(ISSUE_COPY).find(code => errorMessage.split(/[^a-z-]+/).includes(code)) : undefined)

  function apply(next: Arm[]) {
    if (!editable) return
    next = withSlotsFor(next, kind)
    if (next === arms) return
    const structureChanged = next.length !== arms.length || next.some((row, index) => row.key !== arms[index]?.key)
    // Array row IDs identify existing groups in the server's immutable-key check.
    // Move both the hidden ID field and public row metadata with the logical key.
    const idsByKey = new Map(arms.map((row, index) => [row.key, rowIds[index]]))
    const nextIds = structureChanged ? next.map(row => idsByKey.get(row.key) ?? newRowId()) : rowIds
    for (let rowIndex = arms.length - 1; rowIndex >= next.length; rowIndex--) form.removeFieldRow({ path, rowIndex })
    for (let rowIndex = arms.length; rowIndex < next.length; rowIndex++) {
      const row = next[rowIndex]!
      const subFieldState: FormState = {
        ...Object.fromEntries(ARM_FIELDS.filter(key => key !== 'params' || row.kind !== 'holdout').map(key => [key, { value: row[key], initialValue: undefined, valid: true }])),
        id: { value: nextIds[rowIndex], initialValue: undefined, valid: true },
      }
      form.addFieldRow({ path, rowIndex, schemaPath: 'arms', subFieldState })
    }
    next.forEach((row, index) => {
      if (structureChanged && rowIds[index] !== nextIds[index]) form.dispatchFields({ type: 'UPDATE', path: `${path}.${index}.id`, value: nextIds[index] })
      for (const key of ARM_FIELDS) {
        if (key === 'params' && row.kind === 'holdout') {
          // Reusing a physical row for the holdout must drop the former
          // variant's params without assigning params to the holdout.
          if (arms[index]?.params !== undefined) form.dispatchFields({ type: 'UPDATE', path: `${path}.${index}.params`, value: undefined })
          continue
        }
        if (!Object.is(arms[index]?.[key], row[key])) form.dispatchFields({ type: 'UPDATE', path: `${path}.${index}.${key}`, value: row[key] })
      }
    })
    if (structureChanged) form.dispatchFields({ type: 'UPDATE', path, rows: nextIds.map(id =>
      rowMetadata?.find(row => row.id === id) ?? { id: id!, isLoading: true }),
    })
    form.setModified(true)
  }
  useEffect(() => {
    if (!editable) return
    if (!arms.length && !seeded.current) {
      seeded.current = true
      apply(defaultArms(kind))
    } else if (arms.length) apply(arms)
  })
  function update(index: number, patch: Partial<Arm>) {
    apply(arms.map((arm, i) => i === index ? { ...arm, ...patch } : arm))
  }
  return <div className="xp-groups">
    {reason ? <p className="xp-locked-notice">{reason}</p> : null}
    {arms.length ? issues.form.map((issue, i) => <p key={i} role="alert">{issueMessage(issue, total)}</p>) : null}
    {showError && errorMessage ? <p role="alert">{issueMessage({ code: serverCode ?? '', message: errorMessage }, total)}</p> : null}
    <fieldset disabled={!editable} aria-label={ARMS_COPY.groups} style={{ border: 0, padding: 0, margin: 0 }}>
      {arms.map((arm, index) => {
        const rowPath = `${path}.${index}`
        const pageIssue = kind && showsPageTarget(kind, arm.kind) ? pageTargetIssue(arm.pageTarget, arm.kind) : null
        return <section key={index} className="xp-group" style={{ marginBottom: '1.5rem' }}>
          <h3>{GROUP_LABELS[arm.key] ?? arm.label}</h3>
          <TextInput hasMany={false} path={`${rowPath}.label`} label={ARMS_COPY.label} value={arm.label ?? ''} readOnly={!editable}
            onChange={event => update(index, { label: event.target.value })} />
          <label htmlFor={`${rowPath}.weight`}>{ARMS_COPY.weight}<input id={`${rowPath}.weight`} name={`${rowPath}.weight`}
            type="number" min={0} max={100} step={1} style={numberInputStyle} disabled={!editable}
            value={Number.isFinite(arm.weight) ? arm.weight : ''} onChange={event => apply(setWeight(arms, arm.key, event.target.value === '' ? NaN : Number(event.target.value)))} /></label>
          {kind === 'block' && arm.kind !== 'holdout' ? <p>{ARMS_COPY.slot}: {GROUP_LABELS[arm.key] ?? arm.label}</p> : null}
          {kind === 'page' && arm.kind === 'holdout' ? <p>{ARMS_COPY.holdoutPage}</p> : null}
          {kind && showsPageTarget(kind, arm.kind) ? <TextInput hasMany={false} path={`${rowPath}.pageTarget`} label={ARMS_COPY.pagePath}
            value={arm.pageTarget ?? ''} required readOnly={!editable} onChange={event => {
              const next = setPageTarget(arm, event.target.value)
              update(index, { pageTarget: next.pageTarget })
            }} /> : null}
          {pageIssue ? <p role="alert">{pageIssue}</p> : null}
          {kind === 'flag' && point && arm.kind !== 'holdout' ? <>
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
      <Button disabled={!editable || !hasControl || arms.filter(arm => arm.kind === 'variant').length >= 3} onClick={() => apply(addVariant(arms, kind))}>{ARMS_COPY.addVariant}</Button>
      {!arms.some(arm => arm.kind === 'holdout') ? <Button disabled={!editable || !hasControl} onClick={() => apply(addHoldoutArm(arms))}>{ARMS_COPY.addHoldout}</Button> : null}
      <Button disabled={!editable} onClick={() => apply(splitEvenly(arms))}>{ARMS_COPY.splitEvenly}</Button>
    </fieldset>
  </div>
}

'use client'
import { useId } from 'react'
import { Button } from '../../../ui/Button.js'
import { Range } from '../../../ui/Inputs.js'
import { useEffect, useRef, useState } from 'react'
import type { Arm } from '../../../types/contracts.js'
import type { KindParts, SectionProps } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { ARMS_COPY, GROUP_LABELS, issueMessage } from '../../copy/arms.js'
import { addHoldoutArm, addVariant, issuesByRow, removeArm, splitEvenly, totalWeight, withSlotsFor } from '../../arms/arms.model.js'
import { allocationSentence } from '../../allocation.model.js'
import { balanceWeight, orderedVersions, trafficShares } from './testPage.model.js'
import { FieldErrors, ReadOnly, reasonFor, save, TextEdit } from './fields.js'
import { PAGE_COPY } from '../../copy/pages.js'
import { testPageCollection } from '../pagePicker/pagePicker.model.js'
import { Section } from './Section.js'

const COLOURS = { control: 'var(--xp-series-muted)', variantA: 'var(--xp-series-a)', variantB: 'var(--xp-series-b)', variantC: 'var(--xp-series-c)', holdout: 'var(--xp-series-muted)' }
export function VersionsSection({ test, surface, parts }: SectionProps & { parts: KindParts }) {
  const id = useId()
  const doc = test.doc!
  const [weightEdit, setWeightEdit] = useState<{ key: Arm['key']; weight: number } | null>(null)
  const releasedAllocation = useRef<number | null>(null)
  const [allocation, setAllocation] = useState(doc.allocation)
  useEffect(() => setWeightEdit(null), [doc.arms])
  useEffect(() => setAllocation(doc.allocation), [doc.allocation])
  const reason = reasonFor(test, 'arms')
  const live = weightEdit ? balanceWeight(doc.arms, weightEdit.key, weightEdit.weight) : doc.arms
  const ordered = orderedVersions(live)
  const shares = trafficShares(ordered.map(row => row.arm))
  const issues = issuesByRow(live, doc.kind)
  const update = (transform: (arms: Arm[]) => Arm[]) => save(test, 'arms', () => ({ arms: withSlotsFor(transform(test.doc!.arms), test.doc!.kind) }))
  const commitAllocation = () => {
    if (allocation === test.doc!.allocation || releasedAllocation.current === allocation) return
    releasedAllocation.current = allocation
    save(test, 'allocation', () => ({ allocation }))
  }
  return <Section test={test} sectionId="versions">
    {doc.kind === 'page' && testPageCollection(surface.pageCollections, doc, test.preflight?.pagePlacements)?.contentChecks === false ? <p>{PAGE_COPY.contentChecksOff}</p> : null}
    {reason ? <p className="xp-ui-help">{reason}</p> : null}
    <div className="xp-version-rows"><div className="xp-version-grid-head" aria-hidden="true"><span>{C.label}</span><span>{C.weight}</span><span /><span /></div>
    {ordered.filter(({ arm }) => doc.kind !== 'page' || arm.kind !== 'holdout').map(({ arm, index }) => <article className="xp-version-row" key={arm.key} id={`xp-version-${arm.key}`} tabIndex={-1}>
      <TextEdit label={`${GROUP_LABELS[arm.key]}: ${C.label}`} value={arm.label} reason={reason} hideLabel disabled={Boolean(reason)}
        onCommit={label => update(arms => arms.map(current => current.key === arm.key ? { ...current, label } : current))} />
      <TextEdit label={`${GROUP_LABELS[arm.key]}: ${C.weight}`} type="number" min={0} max={100} value={doc.arms[index]!.weight} reason={reason} hideLabel disabled={Boolean(reason)}
        isValid={raw => raw.trim() !== '' && Number.isInteger(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 100} invalidMessage={C.invalidShare}
        onDraft={value => setWeightEdit({ key: arm.key, weight: Number(value) })}
        onCommit={value => update(arms => balanceWeight(arms, arm.key, Number(value)))} />
      <parts.VersionContent test={test} surface={surface} armIndex={index} />
      <div className="xp-ui-button-group xp-version-remove">{arm.kind !== 'control' ? <Button variant="quiet" size="sm" disabled={Boolean(reason)} title={reason ?? undefined} onClick={() => update(arms => splitEvenly(removeArm(arms, arm.key)))}>{C.remove}</Button> : null}</div>
      {issues.rows[index]?.map((issue, i) => <p role="alert" key={i}>{issueMessage(issue, totalWeight(live))}</p>)}
      <FieldErrors test={test} path={`arms.${index}`} />
    </article>)}</div>
    <div className="xp-traffic-bar" role="img" aria-label={`${C.traffic}: ${ordered.map(({ arm }) => `${arm.label} ${arm.weight}%`).join(', ')}`}>
      {ordered.map(({ arm }, i) => <span key={arm.key} style={{ width: `${shares[i]}%`, background: COLOURS[arm.key] }} />)}</div>
    <div className="xp-split-legend">{ordered.map(({ arm }) => <span key={arm.key}><i style={{ background: COLOURS[arm.key] }} />{arm.label} {arm.weight}%</span>)}</div>
    <p className="xp-ui-help">{C.balanceHelp}</p>
    {issues.form.map((issue, i) => <p role="alert" key={i}>{issueMessage(issue, totalWeight(live))}</p>)}
    {test.errors.arms ? <p role="alert">{test.errors.arms}</p> : null}
    <div className="xp-section-actions xp-ui-button-group" title={reason ?? undefined}>
      <Button disabled={Boolean(reason) || doc.arms.filter(arm => arm.kind === 'variant').length >= 3} onClick={() => update(arms => addVariant(arms, doc.kind))}>{C.addVersion}</Button>
      {doc.kind !== 'page' ? <Button disabled={Boolean(reason) || doc.arms.some(arm => arm.kind === 'holdout')} onClick={() => update(addHoldoutArm)}>{C.addHoldout}</Button> : null}
      <Button disabled={Boolean(reason)} onClick={() => update(splitEvenly)}>{C.split}</Button></div>{doc.kind !== 'page' && doc.arms.some(arm => arm.kind === 'holdout') ? <p className="xp-ui-help">{ARMS_COPY.holdout}</p> : null}
    {reasonFor(test, 'allocation') ? <ReadOnly label={C.allocation} value={`${doc.allocation}%`} reason={reasonFor(test, 'allocation')} />
      : <Range id={id} label={C.allocation} help={`${allocation}%`} min={1} max={100} value={allocation}
        onChange={e => { releasedAllocation.current = null; setAllocation(Number(e.target.value)) }} onPointerUp={commitAllocation} onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown'].includes(e.key)) commitAllocation() }}
        onBlur={commitAllocation} />}
    <p>{allocationSentence({ allocation: reasonFor(test, 'allocation') ? doc.allocation : allocation, unitType: doc.unitType, arms: live, status: doc.status })}</p>
    <FieldErrors test={test} path="allocation" />
  </Section>
}

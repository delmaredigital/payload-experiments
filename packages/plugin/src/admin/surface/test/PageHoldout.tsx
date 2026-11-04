'use client'
import type { SectionProps } from '../contracts.js'
import { TEST_PAGE as C } from '../../copy/testPage.js'
import { ARMS_COPY } from '../../copy/arms.js'
import { addHoldoutArm, removeArm, splitEvenly } from '../../arms/arms.model.js'
import { balanceWeight } from './testPage.model.js'
import { FieldErrors, reasonFor, save, TextEdit } from './fields.js'
import { Button } from '../../../ui/Button.js'

/** Whole-page holdouts have no page of their own; their controls live under Advanced. */
export function PageHoldout({ test }: SectionProps) {
  const doc = test.doc!
  const arm = doc.arms.find(item => item.kind === 'holdout')
  const index = doc.arms.findIndex(item => item.kind === 'holdout')
  const reason = reasonFor(test, 'arms')
  return <div>
    {arm ? <>
      <TextEdit label={`Holdout: ${C.label}`} value={arm.label} reason={reason} onCommit={label => save(test, 'arms', () => ({ arms: doc.arms.map(item => item.key === arm.key ? { ...item, label } : item) }))} />
      <TextEdit label={`Holdout: ${C.weight}`} type="number" min={0} max={100} value={arm.weight} reason={reason}
        isValid={value => value.trim() !== '' && Number.isInteger(Number(value)) && Number(value) >= 0 && Number(value) <= 100} invalidMessage={C.invalidShare}
        onCommit={value => save(test, 'arms', () => ({ arms: balanceWeight(doc.arms, arm.key, Number(value)) }))} />
      <FieldErrors test={test} path={`arms.${index}`} />
      <Button disabled={!!reason} onClick={() => save(test, 'arms', () => ({ arms: splitEvenly(removeArm(doc.arms, arm.key)) }))}>{C.remove}</Button>
    </> : <Button disabled={!!reason} onClick={() => save(test, 'arms', () => ({ arms: addHoldoutArm(doc.arms) }))}>{C.addHoldout}</Button>}
    <p className="xp-ui-help">{ARMS_COPY.holdout}</p>
  </div>
}

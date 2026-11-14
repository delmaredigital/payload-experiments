'use client'
import { useState } from 'react'
import type { ArmSlot } from '../../types/puck.js'
import { Button } from '../../ui/Button.js'
import { Dialog } from '../../ui/Dialog.js'
import { slotLabels } from '../copy.js'
import { editorCopy as C } from './copy.js'
import type { EditorExperiment } from './editor.model.js'
import { tabsFor } from './editor.model.js'
import type { ArmWrites } from './VersionBuilder.js'

/** Page content stays editable even when it does not belong to the selected test. */
export function LeftoverVersions({ slots, experiment, writes, canManage, count, onDelete, onSelect }: {
  slots: ArmSlot[]; experiment: EditorExperiment; writes: ArmWrites; canManage: boolean
  count: (slot: ArmSlot) => number; onDelete: (slot: ArmSlot) => void; onSelect: (slot: ArmSlot) => void
}) {
  const [deleting, setDeleting] = useState<ArmSlot | null>(null)
  const versions = new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(tabsFor(experiment).map(tab => tab.label))
  const notice = (slot: ArmSlot) => <div key={slot}>
    <p>{C.orphan(slotLabels[slot], versions)}</p>
    <div className="xp-ui-button-group">
      {canManage && experiment.status === 'draft' ? <Button disabled={writes.busy} onClick={async () => {
        const saved = await writes.write(arms => {
          if (arms.some(arm => arm.key === slot)) return arms
          const next = [...arms]
          const holdout = next.findIndex(arm => arm.kind === 'holdout')
          next.splice(holdout < 0 ? next.length : holdout, 0, { key: slot, slot, kind: 'variant', label: slotLabels[slot], weight: 0 })
          return next
        }, { draftOnly: true })
        if (saved) onSelect(slot)
      }}>{C.addLeftover}</Button> : null}
      <Button onClick={() => setDeleting(slot)}>{C.deleteContent}</Button>
    </div>
  </div>
  return <>
    {slots.length > 2 ? <details className="xp-ui-banner xp-ui-banner--warning xp-slot-leftovers"><summary><span aria-hidden="true">⚠ </span>{C.leftovers(slots.map(slot => slotLabels[slot]).join(', '))}</summary>{slots.map(notice)}</details>
      : slots.map(slot => <div key={slot} className="xp-ui-banner xp-ui-banner--warning xp-slot-leftovers"><span aria-hidden="true">⚠</span>{notice(slot)}</div>)}
    {deleting ? <Dialog open title={C.deleteContentTitle(slotLabels[deleting])} initialFocus="cancel" onClose={() => setDeleting(null)}>
      <div className="xp-slot-drawer"><p>{C.deleteContentHelp(slotLabels[deleting], count(deleting))}</p><div className="xp-ui-button-group">
        <Button data-dialog-cancel onClick={() => setDeleting(null)}>{C.cancel}</Button>
        <Button variant="danger" onClick={() => { onDelete(deleting); setDeleting(null) }}>{C.deleteContent}</Button>
      </div></div>
    </Dialog> : null}
  </>
}

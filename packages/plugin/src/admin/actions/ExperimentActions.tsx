'use client'
import { useState } from 'react'
import { Button, useAuth, useDocumentInfo, useFormFields } from '@payloadcms/ui'
import type { UIFieldClientProps } from 'payload'
import type { ExperimentKind, Status } from '../../types/contracts.js'
import { canManage } from '../permissions.model.js'
import { actionGroupLabel, availableActions } from './actions.model.js'
import type { ActionDecision, ActionGroup, ActionId } from './actions.model.js'
import { ConfirmDialog } from './ConfirmDialog.js'
import { DecideDialog } from './DecideDialog.js'

export function ExperimentActions(_props: UIFieldClientProps) {
  const { id } = useDocumentInfo()
  const { permissions } = useAuth()
  const status = useFormFields(([fields]) => (fields.status?.value ?? 'draft') as Status)
  const kind = useFormFields(([fields]) => (fields.kind?.value ?? 'block') as ExperimentKind)
  // A primitive slice keeps unrelated form edits from rerendering this panel.
  const groups = useFormFields(([fields]) => JSON.stringify(Object.keys(fields)
    .filter(path => /^arms\.\d+\.(key|label|kind)$/.test(path)).sort().map(path => [path, fields[path]?.value])))
  const armsByIndex: Record<string, ActionGroup> = {}
  for (const [path, value] of JSON.parse(groups) as Array<[string, string]>) {
    const [, index, field] = path.split('.')
    const group = armsByIndex[index!] ??= { key: '' }
    group[field as keyof ActionGroup] = value
  }
  const arms = Object.entries(armsByIndex).sort(([a], [b]) => Number(a) - Number(b)).map(([, group]) => group)
  const winnerArm = useFormFields(([fields]) => fields['decision.winnerArm']?.value as string | null | undefined)
  const holdoutReleasedAt = useFormFields(([fields]) => fields['decision.holdoutReleasedAt']?.value as string | null | undefined)
  const contentReport = useFormFields(([fields]) => fields['decision.contentReport']?.value as ActionDecision['contentReport'])
  const [selected, setSelected] = useState<ActionId | null>(null)
  const actions = availableActions({ status, kind, arms, decision: { winnerArm, holdoutReleasedAt, contentReport }, canManage: canManage(permissions) })
  const action = actions.find(candidate => candidate.id === selected)
  if (id == null) return null
  const label = actionGroupLabel(winnerArm ?? 'control', arms.find(group => group.key === winnerArm)?.label)
  return <div className="xp-actions">
    {actions.map(item => <Button key={item.id} buttonStyle={item.tone === 'primary' ? 'primary' : 'secondary'}
      className={`xp-action xp-action--${item.tone}`} onClick={() => setSelected(item.id)}>{item.label}</Button>)}
    {action?.id === 'decide' ? <DecideDialog key={`${id}/decide`} id={id} arms={arms} onClose={() => setSelected(null)} />
      : action ? <ConfirmDialog key={`${id}/${action.id}`} id={id} action={action} winnerLabel={label} onClose={() => setSelected(null)} /> : null}
  </div>
}

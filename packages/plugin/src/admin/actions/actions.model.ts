import type { ExperimentKind, Status } from '../../types/contracts.js'
import type { ArchiveBody, MakeContentResult } from '../../types/endpoints.js'
import { armLabel } from '../labels.js'
import { ACTIONS_COPY as C, hardCodedLabel, makeContentCopy, releaseCopy } from '../copy/actions.js'
import { REVIEW_COPY } from '../copy/review.js'

export type ActionGroup = { key: string; label?: string; kind?: string }
// Local CORE-44 compatibility block: replace with root imports at handover.
export type ContentReport = { docs: MakeContentResult['docs'] } | MakeContentResult['docs']
/** Every recorded content entry is updated or handled by the manager. A present but empty report is done:
 * page tests and flag tests without a host callback record no entries. An absent report is not done. */
export function contentDone(report: ContentReport | null | undefined): boolean {
  const docs = Array.isArray(report) ? report : report?.docs
  return Array.isArray(docs) && docs.every(doc => doc?.ok === true || Boolean(doc?.dismissedAt))
}
// End CORE-44 compatibility block.
export type ActionDecision = { winnerArm?: string | null; holdoutReleasedAt?: string | null; contentReport?: ContentReport | null }
export type ActionId = 'start' | 'stop' | 'decide' | 'release-holdout' | 'make-content' | 'after-content' | 'archive' | 'discard' | 'hard-coded' | 'allocate' | 'add-metric'
export type ExperimentAction = {
  id: ActionId; label: string; tone: 'primary' | 'secondary' | 'danger'
  confirm: { title: string; body: string; phrase?: { action: 'discard' | 'hard-coded' } }
  archive?: ArchiveBody
}

export function actionGroupLabel(key: string, storedLabel?: string): string {
  return storedLabel?.trim() || armLabel(key)
}

export function availableActions({ status, kind, arms, decision, canManage }: {
  status: Status; kind: ExperimentKind; arms: readonly ActionGroup[]; decision?: ActionDecision | null; canManage: boolean
}): ExperimentAction[] {
  if (!canManage) return []
  const action = (id: ActionId, label: string, body: string, tone: ExperimentAction['tone'] = 'secondary', archive?: ArchiveBody,
    phrase?: 'discard' | 'hard-coded'): ExperimentAction => ({ id, label, tone,
    confirm: { title: label, body, ...(phrase ? { phrase: { action: phrase } } : {}) }, ...(archive ? { archive } : {}) })
  const start = action('start', status === 'stopped' ? C.restart : C.start, status === 'stopped' ? C.restartBody : C.startBody, 'primary')
  const decide = action('decide', C.decide, '', 'primary')
  if (status === 'draft') return [start]
  if (status === 'running') return [action('stop', C.stop, C.stopBody, 'danger'), decide,
    action('allocate', REVIEW_COPY.raise, REVIEW_COPY.allocationBody), action('add-metric', REVIEW_COPY.addMetric, '')]
  if (status === 'stopped') return [start, decide, action('archive', C.archive, C.archiveBody, 'secondary', { mode: 'stopped' })]
  if (status !== 'decided') return []
  const winner = arms.find(group => group.key === decision?.winnerArm)
  const label = actionGroupLabel(decision?.winnerArm ?? 'control', winner?.label)
  const rolloutOpen = arms.some(group => group.key === 'holdout') && Boolean(decision?.winnerArm)
    && decision?.winnerArm !== 'control' && !decision?.holdoutReleasedAt
  return [
    ...(rolloutOpen ? [action('release-holdout', C.release, releaseCopy(label))] : []),
    ...(kind !== 'code' ? [action('make-content', C.makeContent, makeContentCopy(label, kind), 'primary')] : []),
    ...(contentDone(decision?.contentReport) ? [action('after-content', C.finish, C.finishBody, 'secondary', { mode: 'after-content' })] : []),
    action('discard', C.discard, C.discardBody, 'danger', { mode: 'discard' }, 'discard'),
    ...(kind === 'code' ? [action('hard-coded', hardCodedLabel(label), hardCodedLabel(label), 'primary', { mode: 'hard-coded' }, 'hard-coded')] : []),
  ]
}

import type { Status } from '../types/contracts.js'
import { statusLabel } from './labels.js'
import { STATUS_TOOLTIPS } from './copy/status.js'

export type PillTone = 'neutral' | 'success' | 'warning' | 'info' | 'muted'
const TONES: Record<Status, PillTone> = {
  draft: 'neutral', running: 'success', stopped: 'warning', decided: 'info', archived: 'muted',
}
export function statusPill({ status, arms = [], decision }: {
  status: Status
  arms?: readonly { key: string }[] | null
  decision?: { winnerArm?: string | null; holdoutReleasedAt?: string | null } | null
}): { label: string; tone: PillTone; tooltip: string } {
  const holdout = status === 'decided' && arms?.some(group => group.key === 'holdout')
    && Boolean(decision?.winnerArm) && decision?.winnerArm !== 'control' && !decision?.holdoutReleasedAt
  return { label: statusLabel(status), tone: TONES[status], tooltip: holdout ? STATUS_TOOLTIPS.decidedWithHoldout : STATUS_TOOLTIPS[status] }
}
